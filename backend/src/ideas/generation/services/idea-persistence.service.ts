import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  GeneratedOutputStatus,
  IdeaGenerationRunStatus,
  IdeaGenerationType,
  Prisma,
  UnlockMethod,
} from '@prisma/client';

import { CreditBalanceService } from '../../../credits/services/credit-balance.service';
import { CreditCacheService } from '../../../credits/services/credit-cache.service';
import { PrismaService } from '../../../prisma/prisma.service';

import { PREMIUM_IDEA_CREDIT_COST } from '../constants/idea-generation.constants';

import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';

import { IdeaDuplicateDetectionService } from './idea-duplicate-detection.service';

/**
 * Prisma transaction client accepted by idea-persistence operations.
 *
 * @author Malak
 */
export type IdeaPersistenceDatabaseClient = Prisma.TransactionClient;

/**
 * Input required to persist one successfully generated idea.
 *
 * The caller must provide exactly one owner:
 * - userId for authenticated generation.
 * - guestSessionId for guest generation.
 *
 * @author Malak
 */
export type PersistGeneratedIdeaInput = {
  /**
   * Generation-run identifier associated with this result.
   */
  readonly runId: string;

  /**
   * Registered user owner.
   *
   * Required for NORMAL_FREE and PREMIUM_CREDIT generation.
   */
  readonly userId?: string;

  /**
   * Guest-session owner.
   *
   * Required for GUEST_FREE generation.
   */
  readonly guestSessionId?: string;

  /**
   * Selected software-domain identifier.
   */
  readonly domainId: string;

  /**
   * Optional selected geographic region.
   */
  readonly selectedRegion?: string;

  /**
   * Collection job that supplied source data and NLP analysis.
   */
  readonly collectionJobId?: string;

  /**
   * Entitlement tier used for generation.
   */
  readonly generationType: IdeaGenerationType;

  /**
   * Parsed and normalized AI output.
   */
  readonly parsedOutput: ParsedIdeaAiOutput;
};

/**
 * Idea record returned after successful persistence.
 *
 * Generated outputs are included so the pipeline can immediately
 * return the complete persisted result without another query.
 *
 * @author Malak
 */
export type PersistedGeneratedIdea = Prisma.IdeaGetPayload<{
  include: {
    generatedOutputs: {
      orderBy: {
        sequence: 'asc';
      };
    };

    domain: {
      select: {
        id: true;
        name: true;
      };
    };

    generationRun: {
      select: {
        id: true;
        status: true;
        progressPercent: true;
      };
    };
  };
}>;

/**
 * Persists generated ideas and consumes their corresponding entitlement
 * atomically.
 *
 * Responsibilities:
 * - Validate idea ownership.
 * - Validate the referenced generation run.
 * - Validate generation-type consistency.
 * - Perform the final duplicate-title check.
 * - Create the base Idea record.
 * - Consume guest, free-user, or premium-credit entitlement.
 * - Store objectives and target users as Prisma JSON values.
 * - Store advanced AI results as GeneratedOutput records.
 * - Link the generation run to the created idea and collection job.
 * - Invalidate credit caches after a committed premium deduction.
 *
 * Transaction guarantees:
 * - A guest session is consumed only if idea persistence succeeds.
 * - A free generation is consumed only if idea persistence succeeds.
 * - A premium credit is deducted only if idea persistence succeeds.
 * - Premium credit transactions are linked to the created idea.
 * - Generated outputs cannot remain without their parent idea.
 * - A run cannot be linked to a partially persisted idea.
 *
 * Run completion is intentionally not handled here. The generation
 * pipeline completes the run through IdeaGenerationRunService only after
 * every required stage succeeds.
 *
 * This service does not:
 * - Execute AI generation.
 * - Parse provider responses.
 * - Start data collection.
 * - Run NLP analysis.
 * - Select generation entitlement.
 * - Publish generated ideas.
 * - Mark the complete generation pipeline as completed.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPersistenceService {
  private readonly logger = new Logger(IdeaPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,
    private readonly creditBalanceService: CreditBalanceService,
    private readonly creditCacheService: CreditCacheService,
  ) {}

  /**
   * Persists one generated idea and consumes its entitlement inside one
   * serializable Prisma transaction.
   *
   * The generation pipeline should call this method only after:
   * - Data collection is complete.
   * - NLP analysis is complete.
   * - AI output has been parsed and validated.
   * - Cancellation has been checked.
   *
   * @param input Validated idea-persistence input.
   * @returns Fully persisted idea with generated outputs and run data.
   */
  async persistIdea(
    input: PersistGeneratedIdeaInput,
  ): Promise<PersistedGeneratedIdea> {
    const normalizedInput = this.normalizeInput(input);

    const persistedIdea = await this.prisma.$transaction(
      async (transaction): Promise<PersistedGeneratedIdea> => {
        const run = await this.validateGenerationRun(
          transaction,
          normalizedInput,
        );

        await this.duplicateDetectionService.assertNotDuplicate(
          normalizedInput.userId,
          normalizedInput.domainId,
          normalizedInput.parsedOutput.coreIdea.title,
          transaction,
        );

        const idea = await this.createIdea(transaction, normalizedInput);

        await this.consumeEntitlement(transaction, normalizedInput, idea.id);

        await this.createGeneratedOutputs(
          transaction,
          idea.id,
          normalizedInput.parsedOutput,
        );

        await this.attachIdeaToGenerationRun(
          transaction,
          run.id,
          idea.id,
          normalizedInput.collectionJobId,
        );

        return this.loadPersistedIdea(transaction, idea.id);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.invalidatePremiumCreditCaches(normalizedInput);

    return persistedIdea;
  }

  /**
   * Normalizes and validates persistence input before opening the database
   * transaction.
   *
   * Ownership rules:
   * - GUEST_FREE requires guestSessionId and rejects userId.
   * - NORMAL_FREE requires userId and rejects guestSessionId.
   * - PREMIUM_CREDIT requires userId and rejects guestSessionId.
   *
   * @param input Raw persistence input.
   * @returns Normalized persistence input.
   */
  private normalizeInput(
    input: PersistGeneratedIdeaInput,
  ): PersistGeneratedIdeaInput {
    const runId = input.runId.trim();
    const domainId = input.domainId.trim();

    const userId = this.normalizeOptionalText(input.userId);
    const guestSessionId = this.normalizeOptionalText(input.guestSessionId);
    const selectedRegion = this.normalizeOptionalText(input.selectedRegion);
    const collectionJobId = this.normalizeOptionalText(input.collectionJobId);

    if (!runId) {
      throw new BadRequestException('Generation run ID is required.');
    }

    if (!domainId) {
      throw new BadRequestException('Domain ID is required.');
    }

    this.validateOwner(input.generationType, userId, guestSessionId);

    return {
      runId,
      userId,
      guestSessionId,
      domainId,
      selectedRegion,
      collectionJobId,
      generationType: input.generationType,
      parsedOutput: input.parsedOutput,
    };
  }

  /**
   * Validates owner fields against the selected generation type.
   *
   * @param generationType Selected generation entitlement.
   * @param userId Optional registered owner.
   * @param guestSessionId Optional guest owner.
   */
  private validateOwner(
    generationType: IdeaGenerationType,
    userId?: string,
    guestSessionId?: string,
  ): void {
    if (generationType === IdeaGenerationType.GUEST_FREE) {
      if (!guestSessionId) {
        throw new BadRequestException(
          'Guest session ID is required for guest idea generation.',
        );
      }

      if (userId) {
        throw new BadRequestException(
          'Guest idea generation cannot be assigned to a registered user.',
        );
      }

      return;
    }

    if (!userId) {
      throw new BadRequestException(
        'User ID is required for authenticated idea generation.',
      );
    }

    if (guestSessionId) {
      throw new BadRequestException(
        'Authenticated idea generation cannot be assigned to a guest session.',
      );
    }
  }

  /**
   * Validates the referenced generation run inside the active transaction.
   *
   * The run must:
   * - Exist.
   * - Not already belong to an idea.
   * - Be in RUNNING state.
   * - Match the selected generation type.
   * - Match the provided owner.
   * - Not have a pending cancellation request.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @returns Validated generation run.
   */
  private async validateGenerationRun(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ) {
    const run = await transaction.ideaGenerationRun.findUnique({
      where: {
        id: input.runId,
      },
      select: {
        id: true,
        userId: true,
        guestSessionId: true,
        ideaId: true,
        generationType: true,
        status: true,
        cancelRequestedAt: true,
      },
    });

    if (!run) {
      throw new NotFoundException(
        `Idea generation run "${input.runId}" was not found.`,
      );
    }

    if (run.ideaId) {
      throw new BadRequestException(
        'The generation run is already linked to a persisted idea.',
      );
    }

    if (run.status !== IdeaGenerationRunStatus.RUNNING) {
      throw new BadRequestException(
        `The generation run cannot persist an idea while its status is "${run.status}".`,
      );
    }

    if (run.generationType !== input.generationType) {
      throw new BadRequestException(
        'The generation run type does not match the persistence request.',
      );
    }

    if (run.userId !== (input.userId ?? null)) {
      throw new BadRequestException(
        'The generation run does not belong to the provided user.',
      );
    }

    if (run.guestSessionId !== (input.guestSessionId ?? null)) {
      throw new BadRequestException(
        'The generation run does not belong to the provided guest session.',
      );
    }

    if (run.cancelRequestedAt) {
      throw new BadRequestException(
        'The generation run was cancelled before idea persistence.',
      );
    }

    return run;
  }

  /**
   * Consumes the entitlement associated with the selected generation type.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @param ideaId Newly created idea identifier.
   */
  private async consumeEntitlement(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
    ideaId: string,
  ): Promise<void> {
    switch (input.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        await this.consumeGuestGeneration(transaction, input);
        return;

      case IdeaGenerationType.NORMAL_FREE:
        await this.consumeFreeGeneration(transaction, input);
        return;

      case IdeaGenerationType.PREMIUM_CREDIT:
        await this.consumePremiumCredit(transaction, input, ideaId);
        return;

      default:
        throw new BadRequestException('Unsupported idea generation type.');
    }
  }

  /**
   * Atomically consumes the one generation allowed for a guest session.
   *
   * The session must exist, remain unused, and not be expired. A nullable
   * expiresAt value represents a session without a configured expiration.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   */
  private async consumeGuestGeneration(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const now = new Date();

    const updated = await transaction.guestSession.updateMany({
      where: {
        id: input.guestSessionId!,
        hasGenerated: false,
        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: now,
            },
          },
        ],
      },
      data: {
        hasGenerated: true,
      },
    });

    if (updated.count === 1) {
      return;
    }

    const session = await transaction.guestSession.findUnique({
      where: {
        id: input.guestSessionId!,
      },
      select: {
        hasGenerated: true,
        expiresAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Guest session was not found.');
    }

    if (session.hasGenerated) {
      throw new BadRequestException(
        'The guest session has already consumed its free generation.',
      );
    }

    throw new BadRequestException(
      'The guest session has expired and cannot generate an idea.',
    );
  }

  /**
   * Consumes one authenticated free generation.
   *
   * The owner-specific generation lock and the serializable transaction
   * protect this read-and-increment operation from normal duplicate requests.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   */
  private async consumeFreeGeneration(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const user = await transaction.user.findUnique({
      where: {
        id: input.userId!,
      },
      select: {
        id: true,
        freeGenerationLimit: true,
        freeGenerationsUsed: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.freeGenerationsUsed >= user.freeGenerationLimit) {
      throw new BadRequestException(
        'No remaining free generations are available.',
      );
    }

    await transaction.user.update({
      where: {
        id: user.id,
      },
      data: {
        freeGenerationsUsed: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Deducts the premium-generation credit through the central credits
   * service and links the resulting CreditTransaction to the created idea.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @param ideaId Newly created premium idea identifier.
   */
  private async consumePremiumCredit(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
    ideaId: string,
  ): Promise<void> {
    await this.creditBalanceService.consumeForIdeaGeneration(
      input.userId!,
      ideaId,
      PREMIUM_IDEA_CREDIT_COST,
      transaction,
    );
  }

  /**
   * Creates the base Idea record.
   *
   * Premium-credit generation creates an immediately unlocked idea using
   * CREDIT_GENERATION as its unlock method. Guest and registered-free ideas
   * remain locked.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @returns Newly created idea.
   */
  private async createIdea(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ) {
    const core = input.parsedOutput.coreIdea;

    const isPremium =
      input.generationType === IdeaGenerationType.PREMIUM_CREDIT;

    return transaction.idea.create({
      data: {
        userId: input.userId ?? null,
        guestSessionId: input.guestSessionId ?? null,
        domainId: input.domainId,
        collectionJobId: input.collectionJobId ?? null,
        selectedRegion: input.selectedRegion ?? null,
        title: core.title,
        problemStatement: core.problemStatement,
        objectives: this.toInputJsonValue(core.objectives),
        targetUsers: this.toInputJsonValue(core.targetUsers),
        limitedAbstract: core.limitedAbstract,
        partialAbstract: core.partialAbstract,
        fullAbstract: core.fullAbstract ?? null,
        generationType: input.generationType,
        isUnlocked: isPremium,
        unlockMethod: isPremium
          ? UnlockMethod.CREDIT_GENERATION
          : UnlockMethod.NONE,
        unlockedAt: isPremium ? new Date() : null,
      },
    });
  }

  /**
   * Persists every advanced output generated for the idea.
   *
   * Outputs are stored independently so they can later be retrieved,
   * regenerated, and extended without changing the Idea model.
   *
   * @param transaction Active Prisma transaction.
   * @param ideaId Persisted parent-idea identifier.
   * @param parsedOutput Parsed and validated AI output.
   */
  private async createGeneratedOutputs(
    transaction: IdeaPersistenceDatabaseClient,
    ideaId: string,
    parsedOutput: ParsedIdeaAiOutput,
  ): Promise<void> {
    const advancedOutputs = parsedOutput.advancedOutputs;

    if (advancedOutputs.length === 0) {
      return;
    }

    const generatedAt = new Date();

    await transaction.generatedOutput.createMany({
      data: advancedOutputs.map((output, index) => ({
        ideaId,
        outputKey: output.outputKey,
        title: output.title,
        sequence: index,
        status: GeneratedOutputStatus.COMPLETED,
        content: output.content,
        structuredContent:
          output.structuredContent === undefined
            ? undefined
            : this.toInputJsonValue(output.structuredContent),
        errorMessage: null,
        generatedAt,
      })),
    });
  }

  /**
   * Links the persisted idea and optional collection job to the running
   * generation run without completing the run.
   *
   * Final run completion remains the responsibility of
   * IdeaGenerationPipelineService and IdeaGenerationRunService after all
   * pipeline stages have succeeded.
   *
   * @param transaction Active Prisma transaction.
   * @param runId Generation-run identifier.
   * @param ideaId Newly persisted idea identifier.
   * @param collectionJobId Optional collection-job identifier.
   */
  private async attachIdeaToGenerationRun(
    transaction: IdeaPersistenceDatabaseClient,
    runId: string,
    ideaId: string,
    collectionJobId?: string,
  ): Promise<void> {
    const updated = await transaction.ideaGenerationRun.updateMany({
      where: {
        id: runId,
        status: IdeaGenerationRunStatus.RUNNING,
        ideaId: null,
        cancelRequestedAt: null,
      },
      data: {
        ideaId,
        collectionJobId: collectionJobId ?? null,
        lastHeartbeatAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new BadRequestException(
        'The generated idea could not be attached because the generation-run state changed.',
      );
    }
  }

  /**
   * Loads the complete persisted result before committing the transaction.
   *
   * @param transaction Active Prisma transaction.
   * @param ideaId Persisted idea identifier.
   * @returns Complete persisted idea result.
   */
  private async loadPersistedIdea(
    transaction: IdeaPersistenceDatabaseClient,
    ideaId: string,
  ): Promise<PersistedGeneratedIdea> {
    return transaction.idea.findUniqueOrThrow({
      where: {
        id: ideaId,
      },
      include: {
        generatedOutputs: {
          orderBy: {
            sequence: 'asc',
          },
        },
        domain: {
          select: {
            id: true,
            name: true,
          },
        },
        generationRun: {
          select: {
            id: true,
            status: true,
            progressPercent: true,
          },
        },
      },
    });
  }

  /**
   * Invalidates credit-related user caches after a premium deduction has
   * committed successfully.
   *
   * Cache failures must not roll back or misreport the already committed
   * idea. They are logged and allowed to expire naturally according to the
   * configured cache TTL.
   *
   * @param input Normalized persistence input.
   */
  private async invalidatePremiumCreditCaches(
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    if (
      input.generationType !== IdeaGenerationType.PREMIUM_CREDIT ||
      !input.userId
    ) {
      return;
    }

    try {
      await this.creditCacheService.invalidateUserCreditCaches(input.userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Premium idea persisted, but credit caches could not be invalidated for user "${input.userId}": ${message}`,
      );
    }
  }

  /**
   * Converts a validated structured value into a Prisma-compatible JSON
   * input value.
   *
   * @param value Parsed JSON-compatible object or array.
   * @returns Prisma-compatible JSON value.
   */
  private toInputJsonValue(
    value: Record<string, unknown> | unknown[],
  ): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  /**
   * Normalizes optional text values.
   *
   * Undefined, null, empty, and whitespace-only values become undefined.
   * Non-empty values are trimmed.
   *
   * @param value Optional text value.
   * @returns Trimmed value or undefined.
   */
  private normalizeOptionalText(
    value: string | null | undefined,
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();

    return normalized || undefined;
  }
}