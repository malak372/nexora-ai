import { BadRequestException, Injectable } from '@nestjs/common';

import {
  CollectionJobStatus,
  CollectionSourceType,
  LanguageCode,
} from '@prisma/client';

import {
  DataCollectionService,
  type IdeaGenerationCollectionInput,
} from '../../data collection/data-collection.service';

import { IntelligentAnalysisService } from '../../nlp/pipeline/intelligent-analysis.service';

import type { IntelligentAnalysisOutput } from '../../nlp/pipeline/types/intelligent-analysis.types';

import { PrismaService } from '../../prisma/prisma.service';

import { REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS } from '../constants/idea-generation.constants';

type ResolveCollectionJobInput = {
  readonly domainId: string;

  readonly country: string;

  readonly city?: string;

  readonly region?: string;

  readonly language: LanguageCode;

  readonly radiusKm?: number;

  /**
   * Effective validated platforms.
   *
   * This value must already have been resolved by
   * IdeaGenerationSelectionService.
   */
  readonly platforms: CollectionSourceType[];

  readonly keywords?: string[];
};

/**
 * Resolves a compatible completed CollectionJob or starts a new one.
 *
 * Reuse requires an exact normalized match for:
 * - Domain.
 * - Country.
 * - City.
 * - Region.
 * - Radius.
 * - Language.
 * - Effective platforms.
 * - Effective custom keywords.
 *
 * @author Malak
 */
@Injectable()
export class CollectionJobResolverService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly dataCollectionService: DataCollectionService,

    private readonly intelligentAnalysisService: IntelligentAnalysisService,
  ) {}

  async resolve(input: ResolveCollectionJobInput) {
    const normalizedInput = this.normalizeInput(input);

    const reusableJob = await this.findReusableJob(normalizedInput);

    if (reusableJob) {
      const nlpOutput = reusableJob.nlpAnalysis
        ? this.mapPersistedAnalysis(reusableJob.nlpAnalysis)
        : await this.intelligentAnalysisService.analyze(reusableJob.id);

      return {
        job: reusableJob,

        nlpOutput,

        selectedPlatformId: await this.resolveSinglePlatformId(reusableJob.id),
      };
    }

    const collectionInput: IdeaGenerationCollectionInput = {
      domainId: normalizedInput.domainId,

      country: normalizedInput.country,

      city: normalizedInput.city,

      region: normalizedInput.region,

      language: normalizedInput.language,

      radiusKm: normalizedInput.radiusKm,

      platforms: normalizedInput.platforms,

      keywords: normalizedInput.keywords,
    };

    const startedJob =
      await this.dataCollectionService.runForIdeaGeneration(collectionInput);

    if (startedJob.status !== CollectionJobStatus.COMPLETED) {
      throw new BadRequestException(
        `Data collection did not complete successfully. Final status: ${startedJob.status}.`,
      );
    }

    const nlpOutput = await this.intelligentAnalysisService.analyze(
      startedJob.id,
    );

    const completedJob = await this.prisma.collectionJob.findUniqueOrThrow({
      where: {
        id: startedJob.id,
      },

      include: {
        nlpAnalysis: true,
      },
    });

    return {
      job: completedJob,

      nlpOutput,

      selectedPlatformId: await this.resolveSinglePlatformId(completedJob.id),
    };
  }

  /**
   * Finds a fresh completed job matching the entire effective request.
   */
  private async findReusableJob(input: ResolveCollectionJobInput) {
    const createdAfter = new Date();

    createdAfter.setDate(
      createdAfter.getDate() - REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS,
    );

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
        },

        createdAt: {
          gte: createdAfter,
        },
      },

      include: {
        nlpAnalysis: true,
      },

      orderBy: {
        completedAt: 'desc',
      },

      take: 20,
    });

    return candidates.find(
      (candidate) =>
        this.sameStringSet(candidate.platforms, input.platforms) &&
        this.sameOptionalStringSet(candidate.keywords, input.keywords),
    );
  }

  /**
   * Maps persisted NLP JSON to the intelligent-analysis contract.
   *
   * The values were originally produced and validated by the NLP
   * pipeline before persistence.
   */
  private mapPersistedAnalysis(analysis: {
    totalTextsAnalyzed: number;
    totalPostsAnalyzed: number;
    totalCommentsAnalyzed: number;
    sentimentStats: unknown;
    keywords: unknown;
    topics: unknown;
    recurringProblems: unknown;
    extractedNeeds: unknown;
    featureRequests: unknown;
    opportunities: unknown;
    insights: unknown;
    dataQuality: unknown;
    samplePosts: unknown;
    sampleComments: unknown;
    aiUsed: boolean;
    confidence: {
      toNumber(): number;
    } | null;
  }): IntelligentAnalysisOutput {
    return {
      totalTextsAnalyzed: analysis.totalTextsAnalyzed,

      totalPostsAnalyzed: analysis.totalPostsAnalyzed,

      totalCommentsAnalyzed: analysis.totalCommentsAnalyzed,

      sentimentStats: analysis.sentimentStats,

      keywords: analysis.keywords,

      topics: analysis.topics ?? [],

      recurringProblems: analysis.recurringProblems,

      extractedNeeds: analysis.extractedNeeds ?? [],

      featureRequests: analysis.featureRequests ?? [],

      opportunities: analysis.opportunities ?? [],

      insights: analysis.insights ?? [],

      dataQuality: analysis.dataQuality,

      samplePosts: analysis.samplePosts ?? [],

      sampleComments: analysis.sampleComments ?? [],

      aiUsed: analysis.aiUsed,

      confidence: analysis.confidence?.toNumber() ?? 0,
    } as IntelligentAnalysisOutput;
  }

  /**
   * Returns Platform.id only when the collected data belongs
   * to exactly one persisted Platform.
   */
  private async resolveSinglePlatformId(
    collectionJobId: string,
  ): Promise<string | undefined> {
    const posts = await this.prisma.socialPost.findMany({
      where: {
        collectionJobId,

        platformId: {
          not: null,
        },
      },

      distinct: ['platformId'],

      select: {
        platformId: true,
      },

      take: 2,
    });

    if (posts.length !== 1 || !posts[0].platformId) {
      return undefined;
    }

    return posts[0].platformId;
  }

  private normalizeInput(
    input: ResolveCollectionJobInput,
  ): ResolveCollectionJobInput {
    return {
      ...input,

      country: input.country.trim(),

      city: this.normalizeOptionalText(input.city),

      region: this.normalizeOptionalText(input.region),

      platforms: [...new Set(input.platforms)],

      keywords: this.normalizeKeywords(input.keywords),
    };
  }

  private sameOptionalStringSet(
    persisted: unknown,
    requested?: readonly string[],
  ): boolean {
    return this.sameStringSet(
      Array.isArray(persisted) ? persisted : [],
      requested ?? [],
    );
  }

  private sameStringSet(
    persisted: unknown,
    requested: readonly string[],
  ): boolean {
    if (!Array.isArray(persisted)) {
      return false;
    }

    const persistedValues = [
      ...new Set(persisted.map(String).map(this.normalizeKey)),
    ].sort();

    const requestedValues = [
      ...new Set(requested.map(this.normalizeKey)),
    ].sort();

    return (
      persistedValues.length === requestedValues.length &&
      persistedValues.every((value, index) => value === requestedValues[index])
    );
  }

  private normalizeKeywords(
    keywords?: readonly string[],
  ): string[] | undefined {
    if (!keywords) {
      return undefined;
    }

    const normalized = [
      ...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)),
    ];

    return normalized.length > 0 ? normalized : undefined;
  }

  private readonly normalizeKey = (value: string): string =>
    value.trim().toLowerCase();

  private normalizeOptionalText(value?: string): string | undefined {
    const normalized = value?.trim();

    return normalized || undefined;
  }
}
