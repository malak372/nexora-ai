import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  CollectionJobStatus,
  LanguageCode,
  Prisma,
} from '@prisma/client';

import {
  DataCollectionService,
  type IdeaGenerationCollectionInput,
} from '../../../data-collection/data-collection.service';

import { IntelligentAnalysisService } from '../../../nlp/pipeline/intelligent-analysis.service';

import type { IntelligentAnalysisOutput } from '../../../nlp/pipeline/types/intelligent-analysis.types';

import { PrismaService } from '../../../prisma/prisma.service';

import {
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
export type ResolvedCollectionJob =
  Prisma.CollectionJobGetPayload<{
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
  constructor(
    private readonly prisma: PrismaService,

    private readonly dataCollectionService:
      DataCollectionService,

    private readonly intelligentAnalysisService:
      IntelligentAnalysisService,
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
    const normalizedInput =
      this.normalizeInput(input);

    const reusableJob =
      await this.findReusableJob(
        normalizedInput,
      );

    if (reusableJob) {
      const nlpOutput =
        reusableJob.nlpAnalysis
          ? this.mapPersistedAnalysis(
              reusableJob,
            )
          : await this.intelligentAnalysisService.analyze(
              reusableJob.id,
            );

      return {
        job: reusableJob,
        nlpOutput,
        reused: true,

        selectedPlatformId:
          this.resolveSingleDataSourceId(
            reusableJob,
          ),
      };
    }

    const collectionInput:
      IdeaGenerationCollectionInput = {
      userId:
        normalizedInput.userId,

      domainId:
        normalizedInput.domainId,

      country:
        normalizedInput.country,

      city:
        normalizedInput.city,

      region:
        normalizedInput.region,

      language:
        normalizedInput.language,

      radiusKm:
        normalizedInput.radiusKm,

      dataSourceKeys: [
        ...normalizedInput.dataSourceKeys,
      ],

      keywords:
        normalizedInput.keywords
          ? [...normalizedInput.keywords]
          : undefined,
    };

    const startedJob =
      await this.dataCollectionService.runForIdeaGeneration(
        collectionInput,
      );

    if (
      startedJob.status !==
      CollectionJobStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Data collection did not complete successfully. Final status: ${startedJob.status}.`,
      );
    }

    const nlpOutput =
      await this.intelligentAnalysisService.analyze(
        startedJob.id,
      );

    const completedJob =
      await this.loadResolvedJob(
        startedJob.id,
      );

    return {
      job: completedJob,
      nlpOutput,
      reused: false,

      selectedPlatformId:
        this.resolveSingleDataSourceId(
          completedJob,
        ),
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
    const createdAfter =
      this.createReuseCutoffDate();

    const candidates =
      await this.prisma.collectionJob.findMany({
        where: {
          domainId:
            input.domainId,

          status:
            CollectionJobStatus.COMPLETED,

          language:
            input.language,

          country: {
            equals:
              input.country,

            mode: 'insensitive',
          },

          city:
            input.city ?? null,

          region:
            input.region ?? null,

          radiusKm:
            input.radiusKm ?? null,

          completedAt: {
            not: null,
          },

          createdAt: {
            gte: createdAfter,
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
      candidates.find(
        (candidate) =>
          this.sameStringSet(
            candidate.sources.map(
              (source) =>
                source.dataSource.key,
            ),
            input.dataSourceKeys,
          ) &&
          this.sameOptionalStringSet(
            candidate.keywords,
            input.keywords,
          ),
      ) ?? null
    );
  }

  /**
   * Loads a completed collection job with every relation required
   * by the generation pipeline.
   *
   * @param collectionJobId Collection-job identifier.
   * @returns Fully loaded collection job.
   */
  private async loadResolvedJob(
    collectionJobId: string,
  ): Promise<ResolvedCollectionJob> {
    return this.prisma.collectionJob.findUniqueOrThrow({
      where: {
        id: collectionJobId,
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
    });
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
    const analysis =
      job.nlpAnalysis;

    if (!analysis) {
      throw new BadRequestException(
        `Collection job "${job.id}" does not contain a persisted NLP analysis.`,
      );
    }

    const sentimentStats =
      analysis.sentimentStats as
        IntelligentAnalysisOutput['sentimentStats'];

    const keywords =
      analysis.keywords as
        IntelligentAnalysisOutput['keywords'];

    const topics =
      (analysis.topics as
        IntelligentAnalysisOutput['topics'] | null) ??
      [];

    const recurringProblems =
      analysis.recurringProblems as
        IntelligentAnalysisOutput['recurringProblems'];

    const extractedNeeds =
      (analysis.extractedNeeds as
        IntelligentAnalysisOutput['extractedNeeds'] | null) ??
      [];

    const featureRequests =
      (analysis.featureRequests as
        IntelligentAnalysisOutput['featureRequests'] | null) ??
      [];

    const opportunities =
      (analysis.opportunities as
        IntelligentAnalysisOutput['opportunities'] | null) ??
      [];

    const insights =
      (analysis.insights as
        IntelligentAnalysisOutput['insights'] | null) ??
      this.createEmptyInsights();

    const dataQuality =
      (analysis.dataQuality as
        IntelligentAnalysisOutput['dataQuality'] | null) ??
      this.createEmptyDataQuality();

    const samplePosts =
      (analysis.samplePosts as
        IntelligentAnalysisOutput['samplePosts'] | null) ??
      [];

    const sampleComments =
      (analysis.sampleComments as
        IntelligentAnalysisOutput['sampleComments'] | null) ??
      [];

    return {
      collectionJobId:
        job.id,

      domain: {
        id:
          job.domain.id,

        name:
          job.domain.name,
      },

      location: {
        country:
          job.country,

        city:
          job.city,

        region:
          job.region,
      },

      platforms:
        job.sources.map(
          (source) =>
            source.dataSource.displayName,
        ),

      totalTextsAnalyzed:
        analysis.totalTextsAnalyzed,

      totalPostsAnalyzed:
        analysis.totalPostsAnalyzed,

      totalCommentsAnalyzed:
        analysis.totalCommentsAnalyzed,

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

      aiUsed:
        analysis.aiUsed,

      confidence:
        analysis.confidence?.toNumber() ??
        0,

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
    const domainId =
      input.domainId.trim();

    const country =
      input.country.trim();

    if (!domainId) {
      throw new BadRequestException(
        'Domain ID is required.',
      );
    }

    if (!country) {
      throw new BadRequestException(
        'Country is required.',
      );
    }

    const dataSourceKeys =
      this.normalizeDataSourceKeys(
        input.dataSourceKeys,
      );

    if (
      dataSourceKeys.length === 0
    ) {
      throw new BadRequestException(
        'At least one data source is required.',
      );
    }

    return {
      userId:
        this.normalizeOptionalText(
          input.userId,
        ),

      domainId,

      country,

      city:
        this.normalizeOptionalText(
          input.city,
        ),

      region:
        this.normalizeOptionalText(
          input.region,
        ),

      language:
        input.language,

      radiusKm:
        input.radiusKm,

      dataSourceKeys,

      keywords:
        this.normalizeKeywords(
          input.keywords,
        ),
    };
  }

  /**
   * Calculates the oldest creation time permitted for reusable
   * collection jobs.
   *
   * @returns Reuse cutoff date.
   */
  private createReuseCutoffDate(): Date {
    const cutoff =
      new Date();

    cutoff.setDate(
      cutoff.getDate() -
        REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS,
    );

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
    const persistedValues =
      Array.isArray(persisted)
        ? persisted.filter(
            (
              value,
            ): value is string =>
              typeof value === 'string',
          )
        : [];

    return this.sameStringSet(
      persistedValues,
      requested ?? [],
    );
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
    const firstValues =
      this.normalizeComparableSet(
        first,
      );

    const secondValues =
      this.normalizeComparableSet(
        second,
      );

    return (
      firstValues.length ===
        secondValues.length &&
      firstValues.every(
        (value, index) =>
          value ===
          secondValues[index],
      )
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
  private normalizeDataSourceKeys(
    values: readonly string[],
  ): string[] {
    return [
      ...new Set(
        values
          .map((value) =>
            this.normalizeKey(value),
          )
          .filter(Boolean),
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

    const uniqueKeywords =
      new Map<string, string>();

    for (const keyword of keywords) {
      const normalizedDisplayValue =
        keyword.trim();

      if (!normalizedDisplayValue) {
        continue;
      }

      const comparisonKey =
        this.normalizeKey(
          normalizedDisplayValue,
        );

      if (
        !uniqueKeywords.has(
          comparisonKey,
        )
      ) {
        uniqueKeywords.set(
          comparisonKey,
          normalizedDisplayValue,
        );
      }
    }

    const normalized = [
      ...uniqueKeywords.values(),
    ];

    return normalized.length > 0
      ? normalized
      : undefined;
  }

  /**
   * Creates a sorted normalized set suitable for equality
   * comparison.
   *
   * @param values Raw values.
   * @returns Sorted normalized unique values.
   */
  private normalizeComparableSet(
    values: readonly string[],
  ): string[] {
    return [
      ...new Set(
        values
          .map((value) =>
            this.normalizeKey(value),
          )
          .filter(Boolean),
      ),
    ].sort();
  }

  /**
   * Normalizes one comparison key.
   *
   * @param value Raw value.
   * @returns Trimmed lowercase value.
   */
  private normalizeKey(
    value: string,
  ): string {
    return value
      .trim()
      .toLowerCase();
  }

  /**
   * Normalizes an optional string.
   *
   * @param value Optional raw value.
   * @returns Trimmed string or undefined.
   */
  private normalizeOptionalText(
    value?: string,
  ): string | undefined {
    if (
      typeof value !== 'string'
    ) {
      return undefined;
    }

    const normalized =
      value.trim();

    return normalized || undefined;
  }
}