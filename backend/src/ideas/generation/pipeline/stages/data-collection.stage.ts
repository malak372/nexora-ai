import { BadRequestException, Injectable } from '@nestjs/common';

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
 * sufficient community data for idea generation.
 *
 * The actual collection operation is currently coordinated by
 * CollectionJobResolverService during the
 * COLLECTION_JOB_RESOLUTION stage.
 *
 * Therefore, this stage acts as an explicit pipeline checkpoint
 * that:
 * - Confirms that a collection job was resolved.
 * - Confirms that the collection job contains collected texts.
 * - Prevents prompt building from continuing with empty data.
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
      'Collected posts count',
    );

    const totalComments = this.normalizeCount(
      collection.totalComments,
      'Collected comments count',
    );

    const totalCollectedTexts = totalPosts + totalComments;

    if (totalCollectedTexts < MIN_COLLECTED_TEXTS_FOR_GENERATION) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INSUFFICIENT_COLLECTED_DATA,

        message: `At least ${MIN_COLLECTED_TEXTS_FOR_GENERATION} collected text record is required before idea generation.`,
      });
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

      resultPreview: `Collection data verified successfully: ${totalPosts} post(s) and ${totalComments} comment(s).`,

      metadata: {
        collectionJobId: collection.collectionJobId,

        reused: collection.reused,

        totalPosts,

        totalComments,

        totalCollectedTexts,
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
