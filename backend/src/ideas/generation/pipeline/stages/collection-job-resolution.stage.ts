import { BadRequestException, Injectable } from '@nestjs/common';

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

import { CollectionJobResolverService } from '../../services/collection-job-resolver.service';

import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
} from '../../types/idea-generation-context.type';

import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';

/**
 * Resolves the collection job and the NLP analysis used by the
 * idea-generation pipeline.
 *
 * The current CollectionJobResolverService performs the complete
 * collection-resolution operation:
 * - Reuses a recent compatible completed collection job when
 *   available.
 * - Creates and executes a new collection job when reuse is not
 *   possible.
 * - Restores or executes the NLP analysis associated with the
 *   resolved collection job.
 *
 * Therefore, this stage stores both:
 * - context.collection
 * - context.nlp
 *
 * The following DATA_COLLECTION and NLP_ANALYSIS stages can use
 * shouldExecute() conditions and skip execution when these values
 * are already available.
 *
 * Responsibilities:
 * - Verify that data sources were selected.
 * - Build normalized collection requirements.
 * - Resolve a reusable or newly completed collection job.
 * - Store collection-job statistics.
 * - Map the intelligent NLP output into the generation context.
 *
 * This stage does not:
 * - Validate entitlement.
 * - Select data sources.
 * - Build prompts.
 * - Generate or persist ideas.
 *
 * @author Malak
 */
@Injectable()
export class CollectionJobResolutionStage implements IdeaGenerationStage {
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly collectionJobResolver: CollectionJobResolverService,
  ) {}

  /**
   * Resolves collection data and its corresponding NLP analysis.
   *
   * @param context Current generation context.
   * @returns Context containing collection and NLP information.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const result = await this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,

      domainId: context.domainId,

      country: context.location.country,

      city: context.location.city ?? undefined,

      region: context.location.region ?? undefined,

      language: context.location.language,

      radiusKm: context.location.radiusKm ?? undefined,

      dataSourceKeys: context.selectedDataSources.map(
        (dataSource) => dataSource.key,
      ),

      keywords: context.keywords.length > 0 ? context.keywords : undefined,
    });

    const nlpContext = this.mapNlpContext(
      result.job.nlpAnalysis?.id ?? null,
      result.nlpOutput,
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,

      domainId: result.job.domain.id,

      domainName: result.job.domain.name,

      collection: {
        collectionJobId: result.job.id,

        reused: result.reused,

        totalPosts: result.nlpOutput.totalPostsAnalyzed,

        totalComments: result.nlpOutput.totalCommentsAnalyzed,
      },

      nlp: nlpContext,
    };

    return {
      context: updatedContext,

      resultPreview: result.reused
        ? `Reused collection job "${result.job.id}".`
        : `Completed new collection job "${result.job.id}".`,

      metadata: {
        collectionJobId: result.job.id,

        reused: result.reused,

        selectedPlatformId: result.selectedPlatformId ?? null,

        totalTextsAnalyzed: result.nlpOutput.totalTextsAnalyzed,

        totalPostsAnalyzed: result.nlpOutput.totalPostsAnalyzed,

        totalCommentsAnalyzed: result.nlpOutput.totalCommentsAnalyzed,

        nlpAnalysisId: nlpContext.nlpAnalysisId,

        nlpAiUsed: nlpContext.aiUsed,

        nlpConfidence: nlpContext.confidence,
      },
    };
  }

  /**
   * Validates all values required before resolving a collection
   * job.
   *
   * @param context Current generation context.
   */
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

  /**
   * Maps the NLP pipeline output into the minimal normalized
   * generation context required by prompt building.
   *
   * @param persistedAnalysisId Persisted NLP-analysis ID.
   * @param output Intelligent NLP output.
   * @returns Normalized generation NLP context.
   */
  private mapNlpContext(
    persistedAnalysisId: string | null,
    output: {
      collectionJobId: string;

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
      confidence: number;
    },
  ): IdeaGenerationNlpContext {
    const nlpAnalysisId = persistedAnalysisId ?? output.collectionJobId;

    return {
      nlpAnalysisId,

      totalTextsAnalyzed: output.totalTextsAnalyzed,

      totalPostsAnalyzed: output.totalPostsAnalyzed,

      totalCommentsAnalyzed: output.totalCommentsAnalyzed,

      sentimentStats: this.toJsonValue(output.sentimentStats),

      keywords: this.toJsonValue(output.keywords),

      topics: this.toJsonValue(output.topics),

      recurringProblems: this.toJsonValue(output.recurringProblems),

      extractedNeeds: this.toJsonValue(output.extractedNeeds),

      featureRequests: this.toJsonValue(output.featureRequests),

      opportunities: this.toJsonValue(output.opportunities),

      insights: this.toJsonValue(output.insights),

      dataQuality: this.toJsonValue(output.dataQuality),

      samplePosts: this.toJsonValue(output.samplePosts),

      sampleComments: this.toJsonValue(output.sampleComments),

      aiUsed: output.aiUsed,

      confidence: Number.isFinite(output.confidence) ? output.confidence : null,
    };
  }

  /**
   * Converts an unknown serializable value into Prisma JSON.
   *
   * Undefined values are converted to null because undefined is
   * not part of Prisma.JsonValue.
   *
   * @param value Unknown JSON-compatible value.
   * @returns Prisma JSON value or null.
   */
  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined) {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Collection-job-resolution stage definition.
   */
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
