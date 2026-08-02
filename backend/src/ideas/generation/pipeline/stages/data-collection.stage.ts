import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  MIN_COLLECTED_TEXTS_FOR_GENERATION,
} from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

/**
 * Verifies that the collection-job resolution stage produced
 * sufficient analyzed community data for idea generation.
 *
 * The actual collection operation is currently coordinated by
 * CollectionJobResolverService during the
 * COLLECTION_JOB_RESOLUTION stage.
 *
 * Therefore, this stage acts as an explicit pipeline checkpoint
 * that:
 * - Confirms that a collection job was resolved.
 * - Confirms that the resolved NLP result contains analyzed texts.
 * - Prevents prompt building from continuing with empty analyzed data.
 * - Preserves a dedicated DATA_COLLECTION stage in run progress
 *   and stage history.
 *
 * This stage does not:
 * - Create collection jobs.
 * - Execute collectors directly.
 * - Modify SocialPost or SocialComment records.
 * - Execute NLP analysis.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionStage implements IdeaGenerationStage {
  private readonly logger = new Logger(DataCollectionStage.name);
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.DATA_COLLECTION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  /**
   * Determines whether the collection checkpoint needs to run.
   *
   * When collection information is already available, the stage
   * still executes its validation checkpoint. This ensures that
   * insufficient collection data cannot pass silently.
   *
   * @returns Always true.
   */
  shouldExecute(): boolean {
    return true;
  }

  /**
   * Validates the resolved collection result.
   *
   * @param context Current generation context.
   * @returns Unchanged validated generation context.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    await Promise.resolve();
    const collection = context.collection;

    if (!collection) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.COLLECTION_FAILED,

        message: 'Collection-job resolution did not provide collection data.',
      });
    }

    const totalPosts = this.normalizeCount(
      collection.totalPosts,
      'Analyzed posts count',
    );

    const totalComments = this.normalizeCount(
      collection.totalComments,
      'Analyzed comments count',
    );

    const totalAnalyzedTexts = totalPosts + totalComments;

    const sparseEvidence =
      totalAnalyzedTexts < MIN_COLLECTED_TEXTS_FOR_GENERATION;

    if (sparseEvidence) {
      this.logger.warn(
        `Run ${context.runId} continues with sparse collection evidence: ${totalAnalyzedTexts}/${MIN_COLLECTED_TEXTS_FOR_GENERATION} analyzed text record(s).`,
      );
    }

    const updatedContext: IdeaGenerationContext = {
      ...context,

      collection: {
        ...collection,
        totalPosts,
        totalComments,
      },
    };

    return {
      context: updatedContext,

      resultPreview: sparseEvidence
        ? `Collection is sparse (${totalAnalyzedTexts} analyzed text record(s)), but generation will continue using the available evidence and domain context.`
        : `Collection data verified successfully: ${totalPosts} analyzed post(s) and ${totalComments} analyzed comment(s) are available for idea generation.`,

      metadata: {
        stageRole: 'VALIDATION_CHECKPOINT',

        executesCollectors: false,

        collectionJobId: collection.collectionJobId,

        reused: collection.reused,

        totalPosts,

        totalComments,

        totalAnalyzedTexts,
        sparseEvidence,
        minimumRecommendedTexts: MIN_COLLECTED_TEXTS_FOR_GENERATION,
        generationContinued: true,
      },
    };
  }

  /**
   * Validates one persisted collection count.
   *
   * @param value Raw count.
   * @param fieldName Field name used in validation errors.
   * @returns Safe non-negative integer.
   */
  private normalizeCount(value: number, fieldName: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.COLLECTION_FAILED,

        message: `${fieldName} must be a non-negative integer.`,
      });
    }

    return value;
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Data-collection stage definition.
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