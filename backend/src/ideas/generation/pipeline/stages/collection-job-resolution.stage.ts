import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import {
  CollectionJobResolverService,
  type ResolveCollectionJobResult,
} from '../../services/collection-job-resolver.service';
import type {
  IdeaGenerationContext,
  SelectedGenerationDomain,
} from '../../types/idea-generation-context.type';
import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';

/**
 * Resolves one bounded collection job for the complete generation request.
 *
 * All selected collectors run in parallel exactly once. Keywords from every
 * selected domain are merged into the same job, preventing the previous
 * multiplicative behavior where GitHub, DEV.to, Product Hunt, Hacker News, and
 * NLP persistence were repeated once per domain.
 *
 * @author Malak
 * @author Eman
 */
@Injectable()
export class CollectionJobResolutionStage implements IdeaGenerationStage {
  private readonly logger = new Logger(CollectionJobResolutionStage.name);

  readonly key = IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly collectionJobResolver: CollectionJobResolverService,
  ) {}

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const domains = this.resolveDomains(context);
    const primaryDomain =
      domains.find((domain) => domain.id === context.domainId) ?? domains[0];

    if (!primaryDomain) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message: 'At least one resolved generation domain is required.',
      });
    }

    /*
     * Execute one collection job for the complete request. Previously the same
     * collectors were executed once per selected domain, which duplicated
     * GitHub, DEV.to, Product Hunt, and Hacker News requests and repeated NLP
     * persistence. One merged job keeps every collector while removing the
     * multiplicative domain fan-out.
     */
    const result = await this.resolveUnifiedCollection(
      context,
      primaryDomain,
      domains,
    );

    const nlp = result.nlpOutput;
    const domainEvidence = domains.map((domain) => {
      /*
       * samplePosts/sampleComments may be empty while analyzedTexts already
       * contains the authoritative in-memory NLP evidence. Build the domain
       * evidence map from analyzedTexts first, then fall back to representative
       * samples. This fixes the previous contradiction where NLP reported
       * analyzed texts but every domainEvidence entry reported zero.
       */
      const analyzedDomainEvidence = this.buildAnalyzedEvidenceForDomain(
        nlp.analyzedTexts,
        domain,
        domain.id === primaryDomain.id,
      );

      const samplePosts =
        analyzedDomainEvidence.posts.length > 0
          ? analyzedDomainEvidence.posts
          : this.filterEvidenceForDomain(nlp.samplePosts, domain);
      const sampleComments =
        analyzedDomainEvidence.comments.length > 0
          ? analyzedDomainEvidence.comments
          : this.filterEvidenceForDomain(nlp.sampleComments, domain);

      const totalPostsAnalyzed = samplePosts.length;
      const totalCommentsAnalyzed = sampleComments.length;
      const totalTextsAnalyzed = totalPostsAnalyzed + totalCommentsAnalyzed;

      return {
        domainId: domain.id,
        domainName: domain.name,
        collectionJobId: result.job.id,
        reused: result.reused,
        totalTextsAnalyzed,
        totalPostsAnalyzed,
        totalCommentsAnalyzed,
        evidenceAvailable: totalTextsAnalyzed > 0,
        samplePosts: this.toJsonValue(samplePosts),
        sampleComments: this.toJsonValue(sampleComments),
      };
    });

    const updatedContext: IdeaGenerationContext = {
      ...context,
      domainId: result.job.domain.id,
      domainName: result.job.domain.name,
      collection: {
        collectionJobId: result.job.id,
        reused: result.reused,
        totalPosts: nlp.totalPostsAnalyzed,
        totalComments: nlp.totalCommentsAnalyzed,
      },
      nlp: {
        nlpAnalysisId:
          result.job.nlpAnalysis?.id ?? nlp.collectionJobId,
        totalTextsAnalyzed: nlp.totalTextsAnalyzed,
        totalPostsAnalyzed: nlp.totalPostsAnalyzed,
        totalCommentsAnalyzed: nlp.totalCommentsAnalyzed,
        sentimentStats: this.toJsonValue(nlp.sentimentStats) as Prisma.JsonObject,
        keywords: this.toJsonValue(nlp.keywords) as Prisma.JsonArray,
        topics: this.toJsonValue(nlp.topics) as Prisma.JsonArray,
        recurringProblems: this.toJsonValue(nlp.recurringProblems) as Prisma.JsonArray,
        extractedNeeds: this.toJsonValue(nlp.extractedNeeds) as Prisma.JsonArray,
        featureRequests: this.toJsonValue(nlp.featureRequests) as Prisma.JsonArray,
        opportunities: this.toJsonValue(nlp.opportunities) as Prisma.JsonArray,
        insights: this.toJsonValue(nlp.insights) as Prisma.JsonArray,
        dataQuality: this.toJsonValue(nlp.dataQuality) as Prisma.JsonObject,
        samplePosts: this.toJsonValue(nlp.samplePosts) as Prisma.JsonArray,
        sampleComments: this.toJsonValue(nlp.sampleComments) as Prisma.JsonArray,
        aiUsed: nlp.aiUsed,
        confidence: nlp.confidence,
      },
      domainEvidence,
    };

    return {
      context: updatedContext,
      resultPreview:
        `Executed all selected collectors once in parallel and analyzed ${nlp.totalTextsAnalyzed} text(s) for ${domains.length} selected domain(s).`,
      metadata: {
        stageRole: 'UNIFIED_PARALLEL_COLLECTION',
        collectionMode: 'FAST_GENERATION',
        domainCount: domains.length,
        collectionJobIds: [result.job.id],
        primaryCollectionJobId: result.job.id,
        reusedCollectionJobs: result.reused ? 1 : 0,
        totalTextsAnalyzed: nlp.totalTextsAnalyzed,
        totalPostsAnalyzed: nlp.totalPostsAnalyzed,
        totalCommentsAnalyzed: nlp.totalCommentsAnalyzed,
        nlpAnalysisId:
          result.job.nlpAnalysis?.id ?? nlp.collectionJobId,
        nlpAiUsed: nlp.aiUsed,
        nlpConfidence: nlp.confidence,
      },
    };
  }

  private async resolveUnifiedCollection(
    context: IdeaGenerationContext,
    primaryDomain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): Promise<ResolveCollectionJobResult> {
    const sourceKeys = this.selectAllActiveSourceKeys(
      context.selectedDataSources.map((source) => source.key),
    );

    return this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: primaryDomain.id,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: sourceKeys,
      keywords: this.buildUnifiedKeywords(context, domains),
      forceRefresh: context.forceRefresh,
      collectionMode: 'FAST_GENERATION',
      /*
       * Collect a stronger first-pass corpus so most runs satisfy evidence
       * requirements without a second targeted-recovery collection. All
       * collectors still execute in parallel, therefore the additional depth
       * improves recall without creating one sequential request chain.
       */
      collectorLimits: {
        maxFetchedPosts: 10,
        maxSavedPosts: 7,
        maxFetchedComments: 16,
        maxSavedComments: 10,
      },
    });
  }

  private resolveDomains(
    context: IdeaGenerationContext,
  ): SelectedGenerationDomain[] {
    return context.selectedDomains.length > 0
      ? context.selectedDomains
      : [
          {
            id: context.domainId,
            name: context.domainName!,
            keywords: context.keywords,
          },
        ];
  }

  private selectAllActiveSourceKeys(keys: readonly string[]): string[] {
    /*
     * DataSourceSelectionStage has already filtered this list to active,
     * allowed sources. Keep every active source and only normalize/deduplicate
     * the keys. Collectors still execute in parallel, while per-source limits
     * above prevent the aggregate corpus from becoming unnecessarily large.
     */
    return [...new Set(
      keys
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean),
    )];
  }

  private buildUnifiedKeywords(
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    const primaryDomain =
      domains.find((domain) => domain.id === context.domainId) ?? domains[0];
    const secondaryDomains = domains.filter(
      (domain) => domain.id !== primaryDomain?.id,
    );

    const primaryTerms = primaryDomain
      ? this.selectSpecificDomainTerms(primaryDomain, 10)
      : [];
    const secondaryTerms = secondaryDomains.flatMap((domain) =>
      this.selectSpecificDomainTerms(domain, 2),
    );

    const problemFocusedPrimaryQueries = primaryDomain
      ? this.buildProblemFocusedQueries(primaryDomain)
      : [];
    const problemFocusedSecondaryQueries = secondaryDomains.flatMap((domain) =>
      this.buildProblemFocusedQueries(domain).slice(0, 1),
    );

    /*
     * Do not send the complete generated keyword catalogue to collectors.
     * Generic phrases such as "government software" or a bare domain name
     * produce political news, unrelated developer tickets, and promotional
     * pages. Prefer specific domain workflows paired with explicit user-pain
     * intent so the first pass retains more usable evidence with fewer calls.
     */
    return [
      ...problemFocusedPrimaryQueries,
      ...primaryTerms,
      ...problemFocusedSecondaryQueries,
      ...secondaryTerms,
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .filter(
        (value, index, values) =>
          values.findIndex(
            (candidate) =>
              this.normalizeTerm(candidate) === this.normalizeTerm(value),
          ) === index,
      )
      .slice(0, 12);
  }


  /** Builds high-intent queries that describe a user problem, not a topic. */
  private buildProblemFocusedQueries(
    domain: SelectedGenerationDomain,
  ): string[] {
    const specificTerms = this.selectSpecificDomainTerms(domain, 5);
    const baseTerms = specificTerms.length > 0
      ? specificTerms
      : [domain.name];

    const intentSuffixes = [
      'user complaint problem',
      'not working difficult confusing',
      'review missing feature',
    ];

    return baseTerms
      .slice(0, 4)
      .flatMap((term, index) => [
        `${term} ${intentSuffixes[index % intentSuffixes.length]}`,
      ]);
  }

  /**
   * Prioritizes domain-specific problem spaces over generated generic phrases
   * such as "media platform", "media software", and "media dashboard".
   */
  private selectSpecificDomainTerms(
    domain: SelectedGenerationDomain,
    limit: number,
  ): string[] {
    const domainTokens = new Set(
      this.normalizeTerm(domain.name)
        .split(/[^\p{L}\p{N}]+/gu)
        .filter((token) => token.length >= 3),
    );
    const genericTail =
      /\b(?:platform|system|application|app|software|dashboard|analytics|monitoring|automation|management|optimization|prediction|recommendation|integration|smart)\b/iu;

    return domain.keywords
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => {
        const normalized = this.normalizeTerm(value);
        const tokens = normalized
          .split(/[^\p{L}\p{N}]+/gu)
          .filter(Boolean);
        const nonDomainTokens = tokens.filter(
          (token) => !domainTokens.has(token),
        );

        return (
          tokens.length >= 2 &&
          nonDomainTokens.length >= 1 &&
          !genericTail.test(normalized)
        );
      })
      .sort((left, right) => {
        const score = (value: string): number => {
          const normalized = this.normalizeTerm(value);
          const tokens = normalized.split(/\s+/u).filter(Boolean);
          const phraseBonus = Math.min(tokens.length, 4) * 5;
          const specificSignal =
            /\b(?:content creation|video streaming|music streaming|podcasting|digital publishing|social media|content moderation|audience analytics|creator economy|gaming|live streaming|interactive media|public service|municipal|urban mobility|traffic|waste|energy|citizen service)\b/iu.test(
              normalized,
            )
              ? 25
              : 0;
          return phraseBonus + specificSignal - normalized.length / 100;
        };

        return score(right) - score(left);
      })
      .slice(0, limit);
  }

  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_REQUEST,
        message:
          'Generation entitlement must be resolved before collection-job resolution.',
      });
    }
    if (!context.domainName) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message:
          'Generation domain must be resolved before collection-job resolution.',
      });
    }
    if (context.selectedDataSources.length === 0) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NO_DATA_SOURCES_AVAILABLE,
        message:
          'At least one active data source must be selected before resolving a collection job.',
      });
    }
  }

  private normalizeTerm(value: string): string {
    return value.toLowerCase().replace(/\s+/gu, ' ').trim();
  }


  /**
   * Builds representative domain evidence directly from the authoritative
   * analyzed-text records returned by the in-memory NLP pipeline.
   *
   * The unified collection job uses merged keywords from all selected domains.
   * A text is assigned to a domain only when its content matches that domain's
   * strong terms. When no selected-domain term can be resolved at all, the
   * primary domain receives the analyzed corpus because it owns the unified
   * collection job; secondary domains remain evidence-free.
   */
  private buildAnalyzedEvidenceForDomain(
    analyzedTexts: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly originalText: string;
      readonly cleanedText: string;
      readonly sentiment: string;
    }[],
    domain: SelectedGenerationDomain,
    isPrimaryDomain: boolean,
  ): {
    readonly posts: Array<{
      readonly id: string;
      readonly text: string;
      readonly sentiment: string;
    }>;
    readonly comments: Array<{
      readonly id: string;
      readonly postId: string;
      readonly text: string;
      readonly sentiment: string;
    }>;
  } {
    const matching = analyzedTexts.filter((item) =>
      this.textMatchesDomain(
        `${item.originalText} ${item.cleanedText}`,
        domain,
      ),
    );

    const resolved =
      matching.length > 0
        ? matching
        : isPrimaryDomain
          ? analyzedTexts
          : [];

    const representative = resolved.filter((item) =>
      this.isRepresentativeProblemEvidence(
        `${item.originalText} ${item.cleanedText}`,
      ),
    );

    const posts = representative
      .filter((item) => item.sourceType === 'POST')
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        text: item.originalText || item.cleanedText,
        sentiment: item.sentiment,
      }));

    const comments = representative
      .filter((item) => item.sourceType === 'COMMENT')
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        postId: item.postId ?? item.id,
        text: item.originalText || item.cleanedText,
        sentiment: item.sentiment,
      }));

    return { posts, comments };
  }

  /**
   * Uses the same strong-term policy as representative evidence filtering.
   */
  /**
   * Keeps representative samples limited to concrete complaints, failures,
   * limitations, requests, or unmet needs. Generic explainers and promotions
   * may remain in NLP totals but are not shown as problem evidence.
   */
  private isRepresentativeProblemEvidence(value: string): boolean {
    const text = this.normalizeTerm(value);
    if (!text || text.length < 35) {
      return false;
    }

    const genericEducational =
      /\b(?:explained|introduction to|what is|learn more|register here|tutorial|course|roadmap|complete guide|beginner guide|from zero|خطة كاملة|شرح|تعلم)\b/iu.test(
        text,
      );
    const problemSignal =
      /\b(?:not accurate enough|insufficient|inaccurate|imprecise|unable|cannot|can't|failed|fails|failure|error|issue|problem|difficulty|struggle|missing|lack|unsupported|need|request|wish|would love|does not work|not working|too slow|confusing|friction)\b/iu.test(
        text,
      );

    return problemSignal && !genericEducational;
  }

  private textMatchesDomain(
    value: string,
    domain: SelectedGenerationDomain,
  ): boolean {
    const text = this.normalizeTerm(value);
    if (!text) return false;

    const domainName = this.normalizeTerm(domain.name);
    if (domainName.length >= 4 && text.includes(domainName)) {
      return true;
    }

    const genericTerms = new Set([
      'privacy',
      'secure',
      'security',
      'data',
      'system',
      'platform',
      'application',
      'software',
      'monitoring',
      'management',
      'analytics',
      'integration',
      'smart',
      'technology',
      'digital',
      'online',
    ]);

    const strongTerms = domain.keywords
      .map((term) => this.normalizeTerm(term))
      .filter(
        (term) =>
          term.length >= 5 &&
          !genericTerms.has(term) &&
          !term.endsWith(' platform') &&
          !term.endsWith(' system') &&
          !term.endsWith(' application') &&
          !term.endsWith(' software'),
      );

    const matched = new Set(
      strongTerms.filter((term) => text.includes(term)),
    );

    return matched.size >= 2;
  }

  private filterEvidenceForDomain(
    values: unknown,
    domain: SelectedGenerationDomain,
  ): unknown[] {
    if (!Array.isArray(values)) return [];

    const domainName = domain.name.trim().toLowerCase();
    const genericTerms = new Set([
      'privacy', 'secure', 'security', 'data', 'system', 'platform',
      'application', 'software', 'monitoring', 'management', 'analytics',
      'integration', 'smart', 'technology', 'digital', 'online',
    ]);
    const strongTerms = domain.keywords
      .map((term) => term.trim().toLowerCase())
      .filter(
        (term) =>
          term.length >= 5 &&
          !genericTerms.has(term) &&
          !term.endsWith(' platform') &&
          !term.endsWith(' system') &&
          !term.endsWith(' application') &&
          !term.endsWith(' software'),
      );

    return values.filter((value) => {
      const text = this.extractEvidenceText(value).toLowerCase();
      if (!text) return false;
      if (domainName.length >= 4 && text.includes(domainName)) return true;

      const matched = new Set(
        strongTerms.filter((term) => text.includes(term)),
      );
      return matched.size >= 2;
    });
  }

  private extractEvidenceText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;
    return [record.text, record.title, record.content]
      .filter((item): item is string => typeof item === 'string')
      .join(' ');
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
    } catch {
      return null;
    }
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }
    return definition;
  }
}