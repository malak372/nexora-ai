import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { CollectionJobStatus, LanguageCode, Prisma } from '@prisma/client';

import type { CollectorInput } from '../../../collectors/base/collector.types';

import {
  DataCollectionService,
  type IdeaGenerationCollectionInput,
} from '../../../data-collection/data-collection.service';

import { IntelligentAnalysisService } from '../../../nlp/pipeline/intelligent-analysis.service';

import type { IntelligentAnalysisOutput, IntelligentTextInput } from '../../../nlp/pipeline/types/intelligent-analysis.types';
import { TextInputBuilderService } from '../../../nlp/pipeline/text-input-builder.service';
import { Sentiment } from '../../../nlp/common/enums/sentiment.enum';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  MIN_REUSABLE_COLLECTION_POSTS,
  MIN_REUSABLE_COLLECTION_TEXTS,
  REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS,
} from '../constants/idea-generation.constants';

/**
 * Collection-job record loaded by the resolver.
 *
 * The related domain, selected data sources, and persisted NLP
 * analysis are included because they are required when reusing a
 * previously completed collection job.
 *
 * @author Malak
 */
export type ResolvedCollectionJob = Prisma.CollectionJobGetPayload<{
  include: {
    domain: {
      select: {
        id: true;
        name: true;
      };
    };

    sources: {
      include: {
        dataSource: {
          select: {
            id: true;
            key: true;
            displayName: true;
          };
        };
      };
    };

    nlpAnalysis: true;
  };
}>;

/**
 * Input used to resolve a compatible collection job.
 *
 * Data-source keys must already be validated by
 * IdeaGenerationSelectionService before this service is called.
 *
 * @author Malak
 */
export type ResolveCollectionJobInput = {
  /**
   * Optional registered user who owns a newly created collection
   * job.
   *
   * It remains undefined for guest-generation workflows.
   */
  readonly userId?: string;

  /**
   * Selected software-domain identifier.
   */
  readonly domainId: string;

  /**
   * Selected country.
   */
  readonly country: string;

  /**
   * Optional selected city.
   */
  readonly city?: string;

  /**
   * Optional selected region.
   */
  readonly region?: string;

  /**
   * Preferred collection and generation language.
   */
  readonly language: LanguageCode;

  /**
   * Optional geographic search radius in kilometres.
   */
  readonly radiusKm?: number;

  /**
   * Validated DataSource.key values.
   *
   * Examples:
   * - youtube
   * - github
   * - stack-overflow
   * - dev-to
   */
  readonly dataSourceKeys: readonly string[];

  /**
   * Optional custom keywords supplied by the requester.
   */
  readonly keywords?: readonly string[];

  /** Runtime searches preserved separately for source-aware collectors. */
  readonly plannedQueries?: readonly string[];
  /** True only when the current runtime queries came from an accepted online AI plan. */
  readonly queriesGeneratedByAi?: boolean;
  readonly sourcePlans?: readonly {
    readonly sourceKey: string;
    readonly queries: readonly string[];
    readonly routingHints: readonly string[];
    readonly discoveryDomainId?: string | null;
    readonly discoveryDomainName?: string | null;
    readonly discoveryDomainIds?: readonly string[];
    readonly discoveryDomainNames?: readonly string[];
    readonly queryIntentId?: string | null;
    readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
    readonly problemFacetIds?: readonly string[];
  }[];

  readonly userDescription?: string;

  /**
   * When true, compatible historical jobs are ignored and a fresh collection
   * plus NLP analysis is produced.
   */
  readonly forceRefresh?: boolean;

  readonly collectionMode?: CollectorInput['collectionMode'];
  readonly collectorLimits?: CollectorInput['limits'];

  /** Runtime-only cancellation signal supplied by the active generation stage. */
  readonly signal?: AbortSignal;

  /** Already validated generation metadata used by FAST_GENERATION. */
  readonly resolvedDomain?: {
    readonly id: string;
    readonly name: string;
    readonly keywords: readonly string[];
  };
  readonly resolvedDataSources?: readonly {
    readonly id: string;
    readonly key: string;
    readonly displayName: string;
  }[];
};

/**
 * Result returned after resolving or creating a collection job.
 *
 * @author Malak
 */
export type ResolveCollectionJobResult = {
  /**
   * Completed collection job used by generation.
   */
  readonly job: ResolvedCollectionJob;

  /**
   * NLP analysis associated with the collection job.
   */
  readonly nlpOutput: IntelligentAnalysisOutput;

  /**
   * Indicates whether an existing completed job was reused.
   */
  readonly reused: boolean;

  /**
   * DataSource.id when exactly one source was used.
   *
   * The Idea model currently names this relation
   * selectedPlatformId for backward compatibility, although the
   * referenced record belongs to DataSource.
   */
  readonly selectedPlatformId?: string;

  /**
   * Direct in-memory evidence captured by FAST_GENERATION before bounded NLP
   * pruning. It is used only for evidence handoff/ranking and does not replace
   * the persisted collection corpus.
   */
  readonly fastEvidenceInputs?: readonly IntelligentTextInput[];

  /**
   * Broader persisted collector corpus captured before deterministic semantic
   * pruning. It is offered to Community AI for triage/classification and is
   * never treated as verified evidence without the normal deterministic guards.
   */
  readonly rawEvidenceInputs?: readonly IntelligentTextInput[];
};

/**
 * Resolves collection data for idea generation.
 *
 * Responsibilities:
 * - Normalize collection parameters.
 * - Reuse a recent compatible completed collection job.
 * - Compare effective data-source keys exactly.
 * - Compare custom keyword sets exactly.
 * - Start a new collection job when reuse is impossible.
 * - Ensure the new collection job completes successfully.
 * - Produce or restore the NLP analysis associated with the job.
 * - Resolve the single selected DataSource identifier when
 *   applicable.
 *
 * A reusable collection job must match:
 * - Domain.
 * - Country.
 * - City.
 * - Region.
 * - Radius.
 * - Language.
 * - Selected data-source keys.
 * - Custom keyword set.
 * - Maximum permitted reuse age.
 *
 * This service does not:
 * - Validate generation entitlement.
 * - Deduct credits.
 * - Consume free generations.
 * - Select active data sources itself.
 * - Persist generated ideas.
 *
 * @author Malak
 */
@Injectable()
export class CollectionJobResolverService {
  private readonly logger = new Logger(CollectionJobResolverService.name);

  /**
   * Process-local hot cache for identical generation requests. A repeated run
   * can reuse the already loaded collection job and persisted NLP output
   * without another Supabase search or relation reload.
   */
  private readonly hotReuseCache = new Map<
    string,
    { readonly expiresAt: number; readonly result: ResolveCollectionJobResult }
  >();

  private static readonly HOT_REUSE_CACHE_TTL_MS = 10 * 60 * 1000;
  private static readonly HOT_REUSE_CACHE_MAX_ENTRIES = 100;

  constructor(
    private readonly prisma: PrismaService,

    private readonly dataCollectionService: DataCollectionService,

    private readonly intelligentAnalysisService: IntelligentAnalysisService,

    private readonly textInputBuilderService: TextInputBuilderService,
  ) {}

  /**
   * Resolves a reusable collection job or creates a new one.
   *
   * @param input Normalized generation collection requirements.
   * @returns Completed job, NLP output, reuse state, and optional
   * single-source identifier.
   */
  async resolve(
    input: ResolveCollectionJobInput,
  ): Promise<ResolveCollectionJobResult> {
    const normalizedInput = this.normalizeInput(input);
    const cacheKey = this.buildHotReuseCacheKey(normalizedInput);

    if (!normalizedInput.forceRefresh) {
      const cached = this.getHotReuseResult(cacheKey);
      if (cached) {
        this.logger.debug(
          `Reused hot collection/NLP result for domain ${normalizedInput.domainId}.`,
        );
        return cached;
      }
    }

    const reusableJob = normalizedInput.forceRefresh
      ? null
      : await this.findReusableJob(normalizedInput);

    if (reusableJob) {
      const nlpOutput = reusableJob.nlpAnalysis
        ? this.mapPersistedAnalysis(reusableJob)
        : await this.intelligentAnalysisService.analyze(reusableJob.id);

      const persistedTextContext =
        await this.textInputBuilderService.build(reusableJob.id);
      const result: ResolveCollectionJobResult = {
        job: reusableJob,
        nlpOutput,
        reused: true,
        selectedPlatformId: this.resolveSingleDataSourceId(reusableJob),
        fastEvidenceInputs: persistedTextContext.inputs,
        rawEvidenceInputs:
          persistedTextContext.rawInputs ?? persistedTextContext.inputs,
      };
      this.setHotReuseResult(cacheKey, result);
      return result;
    }

    const collectionInput: IdeaGenerationCollectionInput = {
      userId: normalizedInput.userId,

      domainId: normalizedInput.domainId,

      country: normalizedInput.country,

      city: normalizedInput.city,

      region: normalizedInput.region,

      language: normalizedInput.language,

      radiusKm: normalizedInput.radiusKm,

      dataSourceKeys: [...normalizedInput.dataSourceKeys],

      keywords: normalizedInput.keywords
        ? [...normalizedInput.keywords]
        : undefined,

      plannedQueries: normalizedInput.plannedQueries
        ? [...normalizedInput.plannedQueries]
        : undefined,

      queriesGeneratedByAi: normalizedInput.queriesGeneratedByAi === true,

      sourcePlans: normalizedInput.sourcePlans
        ? normalizedInput.sourcePlans.map((plan) => ({
            sourceKey: plan.sourceKey,
            queries: [...plan.queries],
            routingHints: [...plan.routingHints],
            discoveryDomainId: plan.discoveryDomainId ?? null,
            discoveryDomainName: plan.discoveryDomainName ?? null,
            discoveryDomainIds: [...(plan.discoveryDomainIds ?? [])],
            discoveryDomainNames: [...(plan.discoveryDomainNames ?? [])],
            queryIntentId: plan.queryIntentId ?? null,
            sourceTier: plan.sourceTier,
            problemFacetIds: [...(plan.problemFacetIds ?? [])],
          }))
        : undefined,

      userDescription: normalizedInput.userDescription,

      collectionMode: normalizedInput.collectionMode,
      collectorLimits: normalizedInput.collectorLimits,
      signal: normalizedInput.signal,
      resolvedDomain: normalizedInput.resolvedDomain,
      resolvedDataSources: normalizedInput.resolvedDataSources,
    };

    const startedJob =
      await this.dataCollectionService.runForIdeaGeneration(collectionInput);

    if (startedJob.status !== CollectionJobStatus.COMPLETED) {
      throw new BadRequestException(
        `Data collection did not complete successfully. Final status: ${startedJob.status}.`,
      );
    }

    /*
     * Snapshot the collector-built in-memory corpus before NLP consumes the
     * fast context. This gives downstream ranking access to strong direct
     * evidence even when the bounded NLP pass keeps only a smaller top slice.
     */
    const fastContext = TextInputBuilderService.peekFastContext(startedJob.id);
    const fastEvidenceInputs = fastContext?.inputs ?? [];
    const rawEvidenceInputs = fastContext?.rawInputs ?? fastEvidenceInputs;

    /*
     * DataCollectionService.completeJobWithTotals() already returns the
     * completed job with the domain, selected sources, and NLP relation shape
     * required by the generation pipeline. Re-querying the same collection job
     * here used to add one full remote PostgreSQL round-trip after every fresh
     * collection.
     *
     * Reuse the authoritative object returned by the completed collection
     * update and run deterministic NLP directly from the in-memory fast
     * context. No evidence, source, or validation rule is removed.
     */
    const completedJob = startedJob as ResolvedCollectionJob;
    const nlpOutput =
      normalizedInput.collectionMode === 'FAST_GENERATION' ||
      normalizedInput.collectionMode === 'TARGETED_RECOVERY'
        ? this.createFastPathNlpOutput(
            completedJob,
            fastEvidenceInputs,
          )
        : await this.resolveNlpOutput(completedJob);

    const result: ResolveCollectionJobResult = {
      job: completedJob,
      nlpOutput,
      reused: false,
      selectedPlatformId: this.resolveSingleDataSourceId(completedJob),
      fastEvidenceInputs,
      rawEvidenceInputs,
    };
    this.setHotReuseResult(cacheKey, result);
    return result;
  }

  private createFastPathNlpOutput(
    job: ResolvedCollectionJob,
    fastEvidenceInputs: readonly IntelligentTextInput[],
  ): IntelligentAnalysisOutput {
    if (fastEvidenceInputs.length === 0) {
      return this.createEmptyNlpOutput(job);
    }

    const normalizedInputs = fastEvidenceInputs
      .map((input) => {
        const content = input.content.replace(/\s+/gu, ' ').trim();
        const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
        const text =
          input.sourceType === 'COMMENT' && title
            ? `${title}. Community comment: ${content}`
            : content;
        return { input, text: text.slice(0, 2_400) };
      })
      .filter(({ text }) => text.length >= 20);

    const samplePosts = normalizedInputs
      .filter(({ input }) => input.sourceType === 'POST')
      .slice(0, 10)
      .map(({ input, text }) => ({
        id: input.id,
        text,
        sentiment: Sentiment.NEUTRAL,
      }));
    const sampleComments = normalizedInputs
      .filter(({ input }) => input.sourceType === 'COMMENT')
      .slice(0, 14)
      .map(({ input, text }) => ({
        id: input.id,
        postId: input.postId ?? input.id,
        text,
        sentiment: Sentiment.NEUTRAL,
      }));

    return {
      collectionJobId: job.id,
      language: job.language,
      domain: {
        id: job.domain.id,
        name: job.domain.name,
      },
      location: {
        country: job.country,
        city: job.city,
        region: job.region,
      },
      platforms: job.sources.map((source) => source.dataSource.key),
      totalTextsAnalyzed: normalizedInputs.length,
      totalPostsAnalyzed: samplePosts.length,
      totalCommentsAnalyzed: sampleComments.length,
      dataQuality: {
        duplicateTextsRemoved: 0,
        spamTextsRemoved: 0,
        irrelevantTextsRemoved: Math.max(
          0,
          fastEvidenceInputs.length - normalizedInputs.length,
        ),
      },
      sentimentStats: {
        positive: 0,
        negative: 0,
        neutral: normalizedInputs.length,
        dominantSentiment: Sentiment.NEUTRAL,
      },
      keywords: [],
      topics: [],
      recurringProblems: [],
      extractedNeeds: [],
      featureRequests: [],
      opportunities: [],
      insights: {
        urgencySignals: [],
        costConcerns: [],
        timeConcerns: [],
        accessibilityConcerns: [],
        safetyConcerns: [],
        reliabilityConcerns: [],
        additionalInsights: [
          'Fast generation preserved collector-filtered evidence directly in memory; full-corpus Community AI owns semantic triage while deterministic provenance and request-alignment guards remain authoritative.',
        ],
      },
      samplePosts,
      sampleComments,
      aiUsed: false,
      confidence: normalizedInputs.length > 0 ? 0.35 : 0,
      analyzedTexts: [],
    };
  }

  private buildHotReuseCacheKey(input: ResolveCollectionJobInput): string {
    return JSON.stringify({
      domainId: input.domainId,
      country: input.country,
      city: input.city ?? null,
      region: input.region ?? null,
      language: input.language,
      radiusKm: input.radiusKm ?? null,
      dataSourceKeys: [...input.dataSourceKeys].sort(),
      keywords: [...(input.keywords ?? [])]
        .map((value) => value.toLowerCase().replace(/\s+/gu, ' ').trim())
        .sort(),
      plannedQueries: [...(input.plannedQueries ?? [])]
        .map((value) => value.toLowerCase().replace(/\s+/gu, ' ').trim())
        .sort(),
      sourcePlans: (input.sourcePlans ?? [])
        .map((plan) => ({
          sourceKey: plan.sourceKey,
          queries: [...plan.queries].sort(),
          routingHints: [...plan.routingHints].sort(),
          discoveryDomainId: plan.discoveryDomainId ?? null,
          discoveryDomainName: plan.discoveryDomainName ?? null,
          discoveryDomainIds: [...(plan.discoveryDomainIds ?? [])].sort(),
          discoveryDomainNames: [...(plan.discoveryDomainNames ?? [])].sort(),
          queryIntentId: plan.queryIntentId ?? null,
          sourceTier: plan.sourceTier ?? null,
          problemFacetIds: [...(plan.problemFacetIds ?? [])].sort(),
        }))
        .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
      userDescription: input.userDescription
        ? input.userDescription.toLowerCase().replace(/\s+/gu, ' ').trim()
        : null,
      collectionMode: input.collectionMode ?? null,
      collectorLimits: input.collectorLimits ?? null,
    });
  }

  private getHotReuseResult(
    key: string,
  ): ResolveCollectionJobResult | null {
    const cached = this.hotReuseCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.hotReuseCache.delete(key);
      return null;
    }
    return { ...cached.result, reused: true };
  }

  private setHotReuseResult(
    key: string,
    result: ResolveCollectionJobResult,
  ): void {
    if (
      this.hotReuseCache.size >=
      CollectionJobResolverService.HOT_REUSE_CACHE_MAX_ENTRIES
    ) {
      const oldestKey = this.hotReuseCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.hotReuseCache.delete(oldestKey);
    }

    this.hotReuseCache.set(key, {
      expiresAt:
        Date.now() + CollectionJobResolverService.HOT_REUSE_CACHE_TTL_MS,
      result,
    });
  }

  /**
   * Runs deterministic NLP when collected rows exist and returns a complete
   * zero-data contract otherwise. This prevents an empty collector response or
   * an NLP edge-case from blocking the later validation-first AI prompt.
   */
  private async resolveNlpOutput(
    job: ResolvedCollectionJob,
  ): Promise<IntelligentAnalysisOutput> {
    if (job.totalPosts + job.totalComments === 0) {
      return this.createEmptyNlpOutput(job);
    }

    try {
      return await this.intelligentAnalysisService.analyze(job.id);
    } catch (error: unknown) {
      this.logger.warn(
        `NLP analysis failed for collection job ${job.id}; generation will continue with a context-only fallback. error=${error instanceof Error ? error.message : String(error)}.`,
      );
      return this.createEmptyNlpOutput(job);
    }
  }

  /** Creates the complete prompt-compatible NLP shape for a zero-data job. */
  private createEmptyNlpOutput(
    job: ResolvedCollectionJob,
  ): IntelligentAnalysisOutput {
    return {
      collectionJobId: job.id,
      language: job.language,
      domain: {
        id: job.domain.id,
        name: job.domain.name,
      },
      location: {
        country: job.country,
        city: job.city,
        region: job.region,
      },
      platforms: job.sources.map((source) => source.dataSource.key),
      totalTextsAnalyzed: 0,
      totalPostsAnalyzed: 0,
      totalCommentsAnalyzed: 0,
      dataQuality: {
        duplicateTextsRemoved: 0,
        spamTextsRemoved: 0,
        irrelevantTextsRemoved: 0,
      },
      sentimentStats: {
        positive: 0,
        negative: 0,
        neutral: 0,
        dominantSentiment: Sentiment.NEUTRAL,
      },
      keywords: [],
      topics: [],
      recurringProblems: [],
      extractedNeeds: [],
      featureRequests: [],
      opportunities: [],
      insights: {
        urgencySignals: [],
        costConcerns: [],
        timeConcerns: [],
        accessibilityConcerns: [],
        safetyConcerns: [],
        reliabilityConcerns: [],
        additionalInsights: [
          'No usable community text was retained within the fast collection budget.',
        ],
      },
      samplePosts: [],
      sampleComments: [],
      aiUsed: false,
      confidence: 0,
      analyzedTexts: [],
    };
  }

  /**
   * Finds the most recent reusable completed collection job.
   *
   * Prisma performs the stable scalar filtering first. Exact
   * source-key and keyword-set comparisons are performed in
   * application code because both values are represented by
   * relations or JSON rather than scalar array columns.
   *
   * @param input Normalized collection requirements.
   * @returns Compatible completed job or null.
   */
  private async findReusableJob(
    input: ResolveCollectionJobInput,
  ): Promise<ResolvedCollectionJob | null> {
    const completedAfter = this.createReuseCutoffDate();

    const candidates = await this.prisma.collectionJob.findMany({
      where: {
        domainId: input.domainId,

        status: CollectionJobStatus.COMPLETED,

        language: input.language,

        country: {
          equals: input.country,

          mode: 'insensitive',
        },

        city: input.city ?? null,

        region: input.region ?? null,

        radiusKm: input.radiusKm ?? null,

        completedAt: {
          not: null,
          gte: completedAfter,
        },
      },

      include: {
        domain: {
          select: {
            id: true,
            name: true,
          },
        },

        sources: {
          include: {
            dataSource: {
              select: {
                id: true,
                key: true,
                displayName: true,
              },
            },
          },
        },

        nlpAnalysis: true,
      },

      orderBy: {
        completedAt: 'desc',
      },

      take: 20,
    });

    return (
      candidates.find((candidate) => {
        const analysis = candidate.nlpAnalysis;

        if (!analysis) {
          return false;
        }

        const hasEnoughReusableData =
          analysis.totalPostsAnalyzed >= MIN_REUSABLE_COLLECTION_POSTS &&
          analysis.totalTextsAnalyzed >= MIN_REUSABLE_COLLECTION_TEXTS;

        return (
          hasEnoughReusableData &&
          this.sameStringSet(
            candidate.sources.map((source) => source.dataSource.key),
            input.dataSourceKeys,
          ) &&
          this.sameOptionalStringSet(candidate.keywords, input.keywords)
        );
      }) ?? null
    );
  }


  /**
   * Restores the IntelligentAnalysisOutput contract from a
   * persisted NlpAnalysis record and its parent collection job.
   *
   * Prisma exposes JSON database columns as Prisma.JsonValue.
   * The NLP pipeline, however, uses strongly typed structures.
   * Each persisted JSON field is therefore converted to its
   * corresponding IntelligentAnalysisOutput field type.
   *
   * These casts are appropriate because the JSON records were
   * originally produced and validated by IntelligentAnalysisService
   * before being stored.
   *
   * Detailed analyzedTexts are not restored because the persisted
   * NlpAnalysis record contains aggregated analysis data rather
   * than the complete per-text analysis collection.
   *
   * @param job Reusable collection job with persisted analysis.
   * @returns Restored NLP pipeline output.
   */
  private mapPersistedAnalysis(
    job: ResolvedCollectionJob,
  ): IntelligentAnalysisOutput {
    const analysis = job.nlpAnalysis;

    if (!analysis) {
      throw new BadRequestException(
        `Collection job "${job.id}" does not contain a persisted NLP analysis.`,
      );
    }

    const sentimentStats =
      analysis.sentimentStats as IntelligentAnalysisOutput['sentimentStats'];

    const keywords = analysis.keywords as IntelligentAnalysisOutput['keywords'];

    const topics =
      (analysis.topics as IntelligentAnalysisOutput['topics'] | null) ?? [];

    const recurringProblems =
      analysis.recurringProblems as IntelligentAnalysisOutput['recurringProblems'];

    const extractedNeeds =
      (analysis.extractedNeeds as
        | IntelligentAnalysisOutput['extractedNeeds']
        | null) ?? [];

    const featureRequests =
      (analysis.featureRequests as
        | IntelligentAnalysisOutput['featureRequests']
        | null) ?? [];

    const opportunities =
      (analysis.opportunities as
        | IntelligentAnalysisOutput['opportunities']
        | null) ?? [];

    const insights =
      (analysis.insights as IntelligentAnalysisOutput['insights'] | null) ??
      this.createEmptyInsights();

    const dataQuality =
      (analysis.dataQuality as
        | IntelligentAnalysisOutput['dataQuality']
        | null) ?? this.createEmptyDataQuality();

    const samplePosts =
      (analysis.samplePosts as
        | IntelligentAnalysisOutput['samplePosts']
        | null) ?? [];

    const sampleComments =
      (analysis.sampleComments as
        | IntelligentAnalysisOutput['sampleComments']
        | null) ?? [];

    return {
      collectionJobId: job.id,

      domain: {
        id: job.domain.id,

        name: job.domain.name,
      },

      location: {
        country: job.country,

        city: job.city,

        region: job.region,
      },
      language: job.language,

      platforms: job.sources.map((source) => source.dataSource.displayName),

      totalTextsAnalyzed: analysis.totalTextsAnalyzed,

      totalPostsAnalyzed: analysis.totalPostsAnalyzed,

      totalCommentsAnalyzed: analysis.totalCommentsAnalyzed,

      dataQuality,

      sentimentStats,

      keywords,

      topics,

      recurringProblems,

      extractedNeeds,

      featureRequests,

      opportunities,

      insights,

      samplePosts,

      sampleComments,

      aiUsed: analysis.aiUsed,

      confidence: analysis.confidence?.toNumber() ?? 0,

      analyzedTexts: [],
    };
  }

  /**
   * Creates the default data-quality structure used when an older
   * persisted analysis does not contain data-quality metadata.
   *
   * @returns Empty data-quality counters.
   */
  private createEmptyDataQuality(): IntelligentAnalysisOutput['dataQuality'] {
    return {
      duplicateTextsRemoved: 0,
      spamTextsRemoved: 0,
      irrelevantTextsRemoved: 0,
    };
  }

  /**
   * Creates the default insights structure used when an older
   * persisted analysis does not contain classified insight data.
   *
   * @returns Empty insight collections.
   */
  private createEmptyInsights(): IntelligentAnalysisOutput['insights'] {
    return {
      urgencySignals: [],
      costConcerns: [],
      timeConcerns: [],
      accessibilityConcerns: [],
      safetyConcerns: [],
      reliabilityConcerns: [],
      additionalInsights: [],
    };
  }

  /**
   * Returns the selected DataSource identifier only when exactly
   * one source belongs to the collection job.
   *
   * For multi-source jobs, the Idea.selectedPlatformId field must
   * remain null because one source cannot accurately represent the
   * complete collection.
   *
   * @param job Resolved collection job.
   * @returns Single DataSource.id or undefined.
   */
  private resolveSingleDataSourceId(
    job: ResolvedCollectionJob,
  ): string | undefined {
    if (job.sources.length !== 1) {
      return undefined;
    }

    return job.sources[0].dataSource.id;
  }

  /**
   * Normalizes collection parameters before matching or creating
   * a collection job.
   *
   * @param input Raw resolver input.
   * @returns Normalized immutable input.
   */
  private normalizeInput(
    input: ResolveCollectionJobInput,
  ): ResolveCollectionJobInput {
    const domainId = input.domainId.trim();

    const country = input.country.trim();

    if (!domainId) {
      throw new BadRequestException('Domain ID is required.');
    }

    if (!country) {
      throw new BadRequestException('Country is required.');
    }

    const dataSourceKeys = this.normalizeDataSourceKeys(input.dataSourceKeys);

    if (dataSourceKeys.length === 0) {
      throw new BadRequestException('At least one data source is required.');
    }

    return {
      userId: this.normalizeOptionalText(input.userId),

      domainId,

      country,

      city: this.normalizeOptionalText(input.city),

      region: this.normalizeOptionalText(input.region),

      language: input.language,

      radiusKm: input.radiusKm,

      dataSourceKeys,

      keywords: this.normalizeKeywords(input.keywords),

      plannedQueries: this.normalizeKeywords(input.plannedQueries),

      queriesGeneratedByAi: input.queriesGeneratedByAi === true,

      sourcePlans: input.sourcePlans
        ?.map((plan) => ({
          sourceKey: plan.sourceKey.trim().toLocaleLowerCase(),
          queries: this.normalizeKeywords(plan.queries) ?? [],
          routingHints: this.normalizeKeywords(plan.routingHints) ?? [],
          discoveryDomainId: this.normalizeOptionalText(plan.discoveryDomainId ?? undefined) ?? null,
          discoveryDomainName: this.normalizeOptionalText(plan.discoveryDomainName ?? undefined) ?? null,
          discoveryDomainIds: this.normalizeKeywords(plan.discoveryDomainIds) ?? [],
          discoveryDomainNames: this.normalizeKeywords(plan.discoveryDomainNames) ?? [],
          queryIntentId: this.normalizeOptionalText(plan.queryIntentId ?? undefined) ?? null,
          sourceTier: plan.sourceTier,
          problemFacetIds: this.normalizeKeywords(plan.problemFacetIds) ?? [],
        }))
        .filter((plan) => plan.sourceKey && plan.queries.length > 0),

      userDescription: this.normalizeOptionalText(input.userDescription),

      forceRefresh: input.forceRefresh === true,
      collectionMode: input.collectionMode,
      collectorLimits: input.collectorLimits,
      signal: input.signal,
      resolvedDomain: input.resolvedDomain,
      resolvedDataSources: input.resolvedDataSources,
    };
  }

  /**
   * Calculates the oldest creation time permitted for reusable
   * collection jobs.
   *
   * @returns Reuse cutoff date.
   */
  private createReuseCutoffDate(): Date {
    const cutoff = new Date();

    cutoff.setDate(cutoff.getDate() - REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS);

    return cutoff;
  }

  /**
   * Compares a persisted JSON keyword collection with requested
   * keywords using normalized set equality.
   *
   * @param persisted Persisted CollectionJob.keywords JSON.
   * @param requested Requested custom keywords.
   * @returns Whether both collections contain the same values.
   */
  private sameOptionalStringSet(
    persisted: Prisma.JsonValue | null,
    requested?: readonly string[],
  ): boolean {
    const persistedValues = Array.isArray(persisted)
      ? persisted.filter((value): value is string => typeof value === 'string')
      : [];

    return this.sameStringSet(persistedValues, requested ?? []);
  }

  /**
   * Compares two string collections as normalized unordered sets.
   *
   * Comparison is:
   * - Case-insensitive.
   * - Whitespace-normalized.
   * - Duplicate-insensitive.
   * - Order-insensitive.
   *
   * @param first First value collection.
   * @param second Second value collection.
   * @returns Whether both normalized sets are equal.
   */
  private sameStringSet(
    first: readonly string[],
    second: readonly string[],
  ): boolean {
    const firstValues = this.normalizeComparableSet(first);

    const secondValues = this.normalizeComparableSet(second);

    return (
      firstValues.length === secondValues.length &&
      firstValues.every((value, index) => value === secondValues[index])
    );
  }

  /**
   * Normalizes data-source keys.
   *
   * Data-source keys are stored in lowercase and compared
   * case-insensitively.
   *
   * @param values Raw source keys.
   * @returns Unique normalized keys.
   */
  private normalizeDataSourceKeys(values: readonly string[]): string[] {
    return [
      ...new Set(
        values.map((value) => this.normalizeKey(value)).filter(Boolean),
      ),
    ];
  }

  /**
   * Normalizes custom keywords while preserving their displayed
   * casing.
   *
   * Duplicate detection remains case-insensitive.
   *
   * @param keywords Optional raw keywords.
   * @returns Unique normalized keywords or undefined.
   */
  private normalizeKeywords(
    keywords?: readonly string[],
  ): string[] | undefined {
    if (!keywords) {
      return undefined;
    }

    const uniqueKeywords = new Map<string, string>();

    for (const keyword of keywords) {
      const normalizedDisplayValue = keyword.trim();

      if (!normalizedDisplayValue) {
        continue;
      }

      const comparisonKey = this.normalizeKey(normalizedDisplayValue);

      if (!uniqueKeywords.has(comparisonKey)) {
        uniqueKeywords.set(comparisonKey, normalizedDisplayValue);
      }
    }

    const normalized = [...uniqueKeywords.values()];

    return normalized.length > 0 ? normalized : undefined;
  }

  /**
   * Creates a sorted normalized set suitable for equality
   * comparison.
   *
   * @param values Raw values.
   * @returns Sorted normalized unique values.
   */
  private normalizeComparableSet(values: readonly string[]): string[] {
    return [
      ...new Set(
        values.map((value) => this.normalizeKey(value)).filter(Boolean),
      ),
    ].sort();
  }

  /**
   * Normalizes one comparison key.
   *
   * @param value Raw value.
   * @returns Trimmed lowercase value.
   */
  private normalizeKey(value: string): string {
    return value.trim().toLowerCase();
  }

  /**
   * Normalizes an optional string.
   *
   * @param value Optional raw value.
   * @returns Trimmed string or undefined.
   */
  private normalizeOptionalText(value?: string): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();

    return normalized || undefined;
  }
}