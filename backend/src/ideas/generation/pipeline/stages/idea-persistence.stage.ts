/**
 * Persists validated generated ideas through the transactional
 * idea-persistence service.
 *
 * @author Malak
 */

import { BadRequestException, Injectable } from '@nestjs/common';

import { IdeaGenerationType } from '@prisma/client';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import { IdeaPersistenceService } from '../../services/idea-persistence.service';

import type {
  IdeaAdvancedOutputKey,
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';

/**
 * Persists a validated generated idea and consumes its generation
 * entitlement atomically.
 *
 * Responsibilities:
 * - Verify all persistence prerequisites.
 * - Verify generation-policy consistency.
 * - Verify owner and generation-type consistency.
 * - Build the normalized parsed AI-output object.
 * - Delegate transactional persistence to IdeaPersistenceService.
 * - Consume guest, free-user, or premium-credit entitlement.
 * - Persist advanced GeneratedOutput records.
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
 * - Set generation progress to 100 percent.
 * - Publish the generated idea.
 * - Generate additional AI content.
 * - Directly execute Prisma persistence operations.
 *
 * Generation-run completion remains the responsibility of
 * IdeaGenerationPipelineService after every required stage
 * succeeds.
 */
@Injectable()
export class IdeaPersistenceStage implements IdeaGenerationStage {
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(private readonly persistenceService: IdeaPersistenceService) {}

  /**
   * Persists the generated idea and enriches the context with
   * persisted identifiers.
   *
   * @param context Current generation context.
   * @returns Updated context containing persisted identifiers.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const policy = context.policy;

    const prompt = context.prompt;

    const collection = context.collection;

    const coreIdea = context.coreIdea;

    if (!policy || !prompt || !collection || !coreIdea) {
      this.throwPersistenceError(
        'Idea persistence prerequisites became unavailable after validation.',
      );
    }

    const parsedOutput: ParsedIdeaAiOutput = {
      coreIdea,

      advancedOutputs: context.advancedOutputs,
    };

    const persistedIdea = await this.persistenceService.persistIdea({
      runId: context.runId,

      promptHistoryId: prompt.promptHistoryId,

      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,

      guestSessionId:
        context.owner.type === IDEA_OWNER_TYPES.GUEST
          ? context.owner.guestSessionId
          : undefined,

      domainId: context.domainId,

      selectedRegion: this.resolveSelectedRegion(context),

      collectionJobId: collection.collectionJobId,

      generationType: context.generationType,

      parsedOutput,
    });

    if (!Array.isArray(persistedIdea.generatedOutputs)) {
      this.throwPersistenceError(
        'Persisted generated outputs were not returned by the persistence service.',
      );
    }

    const generatedOutputIdsByKey = persistedIdea.generatedOutputs.reduce<
      Partial<Record<IdeaAdvancedOutputKey, string>>
    >((result, output) => {
      result[output.outputKey as IdeaAdvancedOutputKey] = output.id;
      return result;
    }, {});

    const updatedContext: IdeaGenerationContext = {
      ...context,

      ideaId: persistedIdea.id,

      generatedOutputIdsByKey,
    };

    return {
      context: updatedContext,

      resultPreview: this.buildResultPreview(
        persistedIdea.id,
        persistedIdea.title,
        Object.keys(generatedOutputIdsByKey).length,
      ),

      metadata: {
        ideaId: persistedIdea.id,

        title: persistedIdea.title,

        domainId: persistedIdea.domain.id,

        domainName: persistedIdea.domain.name,

        collectionJobId: collection.collectionJobId,

        generatedOutputsCount: persistedIdea.generatedOutputs.length,

        generatedOutputIdsByKey,

        generationRunId: persistedIdea.generationRun?.id ?? context.runId,

        generationRunStatus: persistedIdea.generationRun?.status ?? null,

        generationType: context.generationType,

        ownerType: context.owner.type,

        entitlementConsumed: true,

        ideaPersisted: true,
      },
    };
  }

  /**
   * Validates all values required before opening the persistence
   * transaction.
   *
   * @param context Current generation context.
   *
   * @throws BadRequestException When persistence prerequisites are
   * missing or inconsistent.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      this.throwPersistenceError(
        'Generation entitlement must be resolved before idea persistence.',
      );
    }

    if (context.policy.generationType !== context.generationType) {
      this.throwPersistenceError(
        'Resolved generation policy does not match the pipeline generation type.',
      );
    }

    if (!context.prompt) {
      this.throwPersistenceError(
        'Persisted prompt information is required before idea persistence.',
      );
    }

    if (
      typeof context.prompt.promptHistoryId !== 'string' ||
      context.prompt.promptHistoryId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid prompt-history identifier is required before idea persistence.',
      );
    }

    if (!context.coreIdea) {
      this.throwPersistenceError(
        'Validated core idea output is required before idea persistence.',
      );
    }

    if (!Array.isArray(context.advancedOutputs)) {
      this.throwPersistenceError(
        'Validated advanced outputs must be represented as an array.',
      );
    }

    if (!context.collection) {
      this.throwPersistenceError(
        'A resolved collection job is required before idea persistence.',
      );
    }

    if (
      typeof context.collection.collectionJobId !== 'string' ||
      context.collection.collectionJobId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid collection-job identifier is required before idea persistence.',
      );
    }

    if (
      typeof context.runId !== 'string' ||
      context.runId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid generation-run identifier is required before idea persistence.',
      );
    }

    if (
      typeof context.domainId !== 'string' ||
      context.domainId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid domain identifier is required before idea persistence.',
      );
    }

    if (context.ideaId) {
      this.throwPersistenceError(
        'The generation context is already linked to a persisted idea.',
      );
    }

    if (Object.keys(context.generatedOutputIdsByKey).length > 0) {
      this.throwPersistenceError(
        'The generation context is already linked to persisted generated outputs.',
      );
    }

    this.validateOwner(context);
  }

  /**
   * Validates that the resolved owner is compatible with the
   * authorized generation type.
   *
   * Guest generation must belong to a guest session.
   * Authenticated free and premium generation must belong to a
   * registered user.
   *
   * @param context Current generation context.
   */
  private validateOwner(context: IdeaGenerationContext): void {
    switch (context.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        if (context.owner.type !== IDEA_OWNER_TYPES.GUEST) {
          this.throwPersistenceError(
            'Guest-free generation must be associated with a guest session.',
          );
        }

        if (
          typeof context.owner.guestSessionId !== 'string' ||
          context.owner.guestSessionId.trim().length === 0
        ) {
          this.throwPersistenceError(
            'A valid guest-session identifier is required for guest generation.',
          );
        }

        return;

      case IdeaGenerationType.NORMAL_FREE:
      case IdeaGenerationType.PREMIUM_CREDIT:
        if (context.owner.type !== IDEA_OWNER_TYPES.USER) {
          this.throwPersistenceError(
            `${context.generationType} generation must be associated with an authenticated user.`,
          );
        }

        if (
          typeof context.owner.userId !== 'string' ||
          context.owner.userId.trim().length === 0
        ) {
          this.throwPersistenceError(
            'A valid user identifier is required for authenticated idea generation.',
          );
        }

        return;

      default:
        this.assertNeverGenerationType(context.generationType);
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
   * Blank location values are ignored.
   *
   * @param context Current generation context.
   * @returns Most specific selected location value.
   */
  private resolveSelectedRegion(context: IdeaGenerationContext): string {
    const candidates = [
      context.location.region,
      context.location.city,
      context.location.country,
    ];

    const selectedRegion = candidates.find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );

    if (!selectedRegion) {
      this.throwPersistenceError(
        'A valid geographic location is required before idea persistence.',
      );
    }

    return selectedRegion.trim();
  }

  /**
   * Builds a safe stage-result preview.
   *
   * @param ideaId Persisted idea identifier.
   * @param title Persisted idea title.
   * @param generatedOutputsCount Number of persisted outputs.
   * @returns Human-readable persistence result preview.
   */
  private buildResultPreview(
    ideaId: string,
    title: string,
    generatedOutputsCount: number,
  ): string {
    const outputDescription =
      generatedOutputsCount > 0
        ? ` with ${generatedOutputsCount} generated outputs`
        : '';

    return (
      `Generated idea "${title}" ` +
      `(${ideaId}) was persisted successfully` +
      `${outputDescription}.`
    );
  }

  /**
   * Throws a consistent persistence-stage exception.
   *
   * @param message Safe human-readable error message.
   * @param details Optional safe error details.
   *
   * @throws BadRequestException Always.
   */
  private throwPersistenceError(
    message: string,
    details?: Record<string, unknown>,
  ): never {
    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.PERSISTENCE_FAILED,

      message,

      ...(details ?? {}),
    });
  }

  /**
   * Provides exhaustive handling if a new generation type is
   * introduced.
   *
   * @param generationType Unexpected generation type.
   */
  private assertNeverGenerationType(generationType: never): never {
    return this.throwPersistenceError(
      `Unsupported idea generation type "${String(generationType)}".`,
    );
  }

  /**
   * Resolves the static stage definition from the centralized
   * stage registry.
   *
   * @returns Idea-persistence stage definition.
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
