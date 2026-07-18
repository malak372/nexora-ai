import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
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

import {
  IdeaPersistenceService,
} from '../../services/idea-persistence.service';

import type {
  IdeaGenerationContext,
} from '../../types/idea-generation-context.type';

import type {
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

import {
  IDEA_OWNER_TYPES,
} from '../../../shared/constants/ideas.constants';

/**
 * Persists the validated generated idea and consumes its
 * generation entitlement atomically.
 *
 * Responsibilities:
 * - Verify all persistence prerequisites.
 * - Build the normalized parsed AI output.
 * - Delegate transactional persistence to IdeaPersistenceService.
 * - Consume guest, free-user, or premium-credit entitlement.
 * - Store advanced GeneratedOutput records.
 * - Attach the created idea and collection job to the generation
 *   run.
 * - Store persisted identifiers in the pipeline context.
 *
 * IdeaPersistenceService performs a second duplicate check inside
 * the serializable transaction to protect against concurrent
 * persistence races.
 *
 * This stage does not:
 * - Mark the generation run as completed.
 * - Set run progress to 100.
 * - Publish the generated idea.
 * - Generate additional AI content.
 *
 * Run completion remains the responsibility of
 * IdeaGenerationPipelineService after every required stage
 * succeeds.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPersistenceStage
  implements IdeaGenerationStage
{
  /**
   * Stable pipeline-stage key.
   */
  readonly key =
    IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition =
    this.resolveDefinition();

  constructor(
    private readonly persistenceService:
      IdeaPersistenceService,
  ) {}

  /**
   * Persists the generated idea and enriches the context with
   * persisted identifiers.
   *
   * @param context Current generation context.
   * @returns Context containing the persisted idea identifier.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const parsedOutput:
      ParsedIdeaAiOutput = {
        coreIdea:
          context.coreIdea!,

        advancedOutputs:
          context.advancedOutputs,
      };

    const persistedIdea =
      await this.persistenceService.persistIdea({
        runId:
          context.runId,

        userId:
          context.owner.type ===
          IDEA_OWNER_TYPES.USER
            ? context.owner.userId
            : undefined,

        guestSessionId:
          context.owner.type ===
          IDEA_OWNER_TYPES.GUEST
            ? context.owner
                .guestSessionId
            : undefined,

        domainId:
          context.domainId,

        selectedRegion:
          this.resolveSelectedRegion(
            context,
          ),

        collectionJobId:
          context.collection
            ?.collectionJobId,

        generationType:
          context.generationType,

        parsedOutput,
      });

    const generatedOutputIds =
      persistedIdea.generatedOutputs.map(
        (output) => output.id,
      );

    const updatedContext: IdeaGenerationContext = {
      ...context,

      ideaId:
        persistedIdea.id,

      generatedOutputIds,
    };

    return {
      context: updatedContext,

      resultPreview:
        `Generated idea "${persistedIdea.id}" persisted successfully.`,

      metadata: {
        ideaId:
          persistedIdea.id,

        title:
          persistedIdea.title,

        domainId:
          persistedIdea.domain.id,

        domainName:
          persistedIdea.domain.name,

        collectionJobId:
          context.collection
            ?.collectionJobId ??
          null,

        generatedOutputsCount:
          persistedIdea
            .generatedOutputs.length,

        generatedOutputIds,

        generationRunId:
          persistedIdea
            .generationRun?.id ??
          context.runId,

        generationRunStatus:
          persistedIdea
            .generationRun?.status ??
          null,

        generationType:
          context.generationType,
      },
    };
  }

  /**
   * Validates all values required before opening the persistence
   * transaction.
   *
   * @param context Current generation context.
   */
  private validateContext(
    context: IdeaGenerationContext,
  ): void {
    if (!context.policy) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .PERSISTENCE_FAILED,

        message:
          'Generation entitlement must be resolved before idea persistence.',
      });
    }

    if (!context.coreIdea) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .PERSISTENCE_FAILED,

        message:
          'Validated core idea output is required before idea persistence.',
      });
    }

    if (!context.collection) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .PERSISTENCE_FAILED,

        message:
          'A resolved collection job is required before idea persistence.',
      });
    }

    if (context.ideaId) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .PERSISTENCE_FAILED,

        message:
          'The generation context is already linked to a persisted idea.',
      });
    }
  }

  /**
   * Resolves the most specific selected geographic region stored
   * on the generated idea.
   *
   * Priority:
   * - Explicit region.
   * - City.
   * - Country.
   *
   * @param context Current generation context.
   * @returns Selected region value.
   */
  private resolveSelectedRegion(
    context: IdeaGenerationContext,
  ): string {
    return (
      context.location.region ??
      context.location.city ??
      context.location.country
    );
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Idea-persistence stage definition.
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