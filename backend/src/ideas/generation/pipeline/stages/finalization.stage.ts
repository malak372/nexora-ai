
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import {
  IDEA_GENERATION_ERROR_CODES,
} from '../../constants/idea-generation.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type {
  IdeaGenerationContext,
} from '../../types/idea-generation-context.type';

/**
 * Performs final pipeline consistency checks before the
 * generation run is completed.
 *
 * Responsibilities:
 * - Verify that the idea was persisted.
 * - Verify that collection information remains available.
 * - Verify that validated core idea output remains available.
 * - Verify that premium generated outputs were persisted when
 *   premium output generation was authorized.
 * - Produce final pipeline metadata.
 *
 * This stage intentionally does not call completeRun().
 *
 * IdeaGenerationPipelineService is responsible for invoking
 * IdeaGenerationRunService.completeRun() only after this stage and
 * every preceding required stage succeed.
 *
 * This separation guarantees that:
 * - A finalization-stage failure cannot leave the run marked as
 *   completed.
 * - Progress 100 is written only by completeRun().
 * - Pipeline completion remains centralized and consistent.
 *
 * @author Malak
 */
@Injectable()
export class FinalizationStage
  implements IdeaGenerationStage
{
  /**
   * Stable pipeline-stage key.
   */
  readonly key =
    IDEA_GENERATION_STAGE_KEYS.FINALIZATION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition =
    this.resolveDefinition();

  /**
   * Validates final generation context consistency.
   *
   * @param context Current generation context.
   * @returns Final validated context.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    return {
      context,

      resultPreview:
        `Idea generation finalized successfully for idea "${context.ideaId}".`,

      metadata: {
        runId: context.runId,

        ideaId: context.ideaId,

        generationType:
          context.generationType,

        domainId: context.domainId,

        domainName: context.domainName,

        collectionJobId:
          context.collection
            ?.collectionJobId ?? null,

        collectionReused:
          context.collection
            ?.reused ?? false,

        generatedOutputsCount:
          context.generatedOutputIds.length,

        premiumOutputsEnabled:
          context.policy
            ?.includePremiumOutputs ?? false,

        completedAt:
          new Date().toISOString(),
      },
    };
  }

  /**
   * Validates the final state produced by all previous stages.
   *
   * @param context Final generation context.
   */
  private validateContext(
    context: IdeaGenerationContext,
  ): void {
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
      context.policy.includePremiumOutputs &&
      context.generatedOutputIds.length === 0
    ) {
      this.throwFinalizationError(
        'Premium generation completed without persisted generated-output records.',
      );
    }
  }

  /**
   * Throws a standardized final pipeline validation error.
   *
   * Finalization errors use PIPELINE_FAILED because the shared
   * generation error-code contract does not expose a dedicated
   * FINALIZATION_FAILED code.
   *
   * @param message Human-readable error message.
   */
  private throwFinalizationError(
    message: string,
  ): never {
    throw new BadRequestException({
      code:
        IDEA_GENERATION_ERROR_CODES
          .PIPELINE_FAILED,

      message,
    });
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Finalization-stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition =
      findIdeaGenerationStageDefinition(
        this.key,
      );

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}
