import { BadRequestException, Injectable } from '@nestjs/common';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';

import { REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS } from '../../constants/idea-output.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

/**
 * Performs final pipeline consistency checks before the generation
 * run is marked as completed.
 *
 * This stage runs after IdeaPersistenceStage and verifies that the
 * committed database result matches the entitlement selected for
 * the generation run.
 *
 * IdeaGenerationPipelineService remains responsible for calling
 * completeRun() only after this stage succeeds.
 *
 * @author Malak
 */
@Injectable()
export class FinalizationStage implements IdeaGenerationStage {
  /** Stable pipeline-stage key. */
  readonly key = IDEA_GENERATION_STAGE_KEYS.FINALIZATION;

  /** Static pipeline-stage definition. */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  /**
   * Validates the final committed generation context.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    await Promise.resolve();
    this.validateContext(context);

    return {
      context,
      resultPreview: `Idea generation finalized successfully for idea "${context.ideaId}".`,
      metadata: {
        runId: context.runId,
        ideaId: context.ideaId,
        generationType: context.generationType,
        domainId: context.domainId,
        domainName: context.domainName,
        collectionJobId: context.collection?.collectionJobId ?? null,
        collectionReused: context.collection?.reused ?? false,
        generatedOutputsCount: Object.keys(context.generatedOutputIdsByKey)
          .length,
        premiumOutputsEnabled: context.policy?.includePremiumOutputs ?? false,
        completedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Validates the final state produced by every previous stage.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      this.throwFinalizationError(
        'Generation entitlement is missing during finalization.',
      );
    }

    if (!context.collection) {
      this.throwFinalizationError(
        'Collection-job information is missing during finalization.',
      );
    }

    if (!context.nlp) {
      this.throwFinalizationError(
        'NLP analysis is missing during finalization.',
      );
    }

    if (!context.coreIdea) {
      this.throwFinalizationError(
        'Validated core idea output is missing during finalization.',
      );
    }

    if (!context.ideaId?.trim()) {
      this.throwFinalizationError(
        'The generation run is not linked to a persisted idea.',
      );
    }

    if (
      !context.generatedOutputIdsByKey ||
      typeof context.generatedOutputIdsByKey !== 'object' ||
      Array.isArray(context.generatedOutputIdsByKey)
    ) {
      this.throwFinalizationError(
        'Persisted generated-output identifiers are invalid.',
      );
    }

    if (!context.policy.includePremiumOutputs) {
      return;
    }

    const persistedOutputIds = REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.map(
      (outputKey) => ({
        outputKey,
        generatedOutputId: context.generatedOutputIdsByKey[outputKey],
      }),
    );

    const missingOutputKeys = persistedOutputIds
      .filter(({ generatedOutputId }) => !generatedOutputId?.trim())
      .map(({ outputKey }) => outputKey);

    if (missingOutputKeys.length > 0) {
      this.throwFinalizationError(
        `Premium generation completed without persisted required outputs: ${missingOutputKeys.join(', ')}.`,
      );
    }

    const outputIds = persistedOutputIds.map(
      ({ generatedOutputId }) => generatedOutputId as string,
    );

    if (new Set(outputIds).size !== outputIds.length) {
      this.throwFinalizationError(
        'Premium generation contains duplicate persisted generated-output identifiers.',
      );
    }
  }

  /**
   * Throws a standardized final pipeline validation error.
   */
  private throwFinalizationError(message: string): never {
    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.PIPELINE_FAILED,
      message,
    });
  }

  /**
   * Resolves the static stage definition.
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
