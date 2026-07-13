import { ConflictException, Injectable, Logger } from '@nestjs/common';

import {
  AlertType,
  AuditAction,
  AuditTargetType,
  IdeaGenerationType,
  Prisma,
  UnlockMethod,
} from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';

import { CreditBalanceService } from '../../credits/services/credit-balance.service';

import { CreditCacheService } from '../../credits/services/credit-cache.service';

import type { IntelligentAnalysisOutput } from '../../nlp/pipeline/types/intelligent-analysis.types';

import { PrismaService } from '../../prisma/prisma.service';

import { LOW_CREDIT_BALANCE_THRESHOLD } from '../constants/idea-generation.constants';

import type {
  FreeIdeaAiOutput,
  GuestIdeaAiOutput,
  IdeaAiOutput,
  PremiumIdeaAiOutput,
} from '../types/idea-ai-output.type';

import { GuestIdeaSessionService } from './guest-idea-session.service';

import { IdeaDuplicateDetectionService } from './idea-duplicate-detection.service';

import { IdeaOutputMapperService } from './idea-output-mapper.service';

type PersistIdeaInput = {
  readonly generationType: IdeaGenerationType;

  readonly userId?: string;

  readonly guestSessionId?: string;

  readonly domainId: string;

  readonly selectedPlatformId?: string;

  readonly selectedRegion?: string;

  readonly collectionJobId: string;

  readonly commentsCount: number;

  readonly promptHistoryId: string;

  readonly aiOperationId: string;

  readonly aiOutput: IdeaAiOutput;

  readonly nlpOutput: IntelligentAnalysisOutput;
};

/**
 * Persists one generated idea and all related entitlement changes.
 *
 * The database transaction includes:
 * - Guest/free entitlement consumption.
 * - Idea creation.
 * - Premium credit deduction.
 * - Premium GeneratedOutput persistence.
 * - PromptHistory attachment.
 * - ExternalApiLog attachment.
 * - Credit alert creation.
 * - Audit logging.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPersistenceService {
  private readonly logger = new Logger(IdeaPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,

    private readonly creditBalanceService: CreditBalanceService,

    private readonly creditCacheService: CreditCacheService,

    private readonly auditService: AuditService,

    private readonly guestSessionService: GuestIdeaSessionService,

    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,

    private readonly outputMapperService: IdeaOutputMapperService,
  ) {}

  async persist(input: PersistIdeaInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.consumeNonCreditEntitlement(input, tx);

      await this.duplicateDetectionService.assertNotDuplicate(
        input.userId,
        input.domainId,
        input.aiOutput.title,
        tx,
      );

      const idea = await tx.idea.create({
        data: this.buildIdeaCreateData(input),
      });

      let creditResult:
        | Awaited<ReturnType<CreditBalanceService['consumeForIdeaGeneration']>>
        | undefined;

      if (input.generationType === IdeaGenerationType.PREMIUM_CREDIT) {
        creditResult = await this.creditBalanceService.consumeForIdeaGeneration(
          input.userId!,
          idea.id,
          1,
          tx,
        );

        await tx.generatedOutput.createMany({
          data: this.outputMapperService.mapPremium(
            idea.id,
            input.aiOutput as PremiumIdeaAiOutput,
            input.nlpOutput,
          ),
        });

        await this.createCreditAlertIfRequired(
          input.userId!,
          creditResult.balanceAfter,
          tx,
        );
      }

      await tx.promptHistory.update({
        where: {
          id: input.promptHistoryId,
        },

        data: {
          ideaId: idea.id,
        },
      });

      await tx.externalApiLog.updateMany({
        where: {
          operationId: input.aiOperationId,

          ideaId: null,
        },

        data: {
          ideaId: idea.id,
        },
      });

      await this.auditService.createLog(
        {
          actorId: input.userId ?? null,

          action: AuditAction.USER_GENERATE_IDEA,

          targetType: AuditTargetType.IDEA,

          targetId: idea.id,

          newValue: {
            generationType: input.generationType,

            collectionJobId: input.collectionJobId,

            commentsCount: input.commentsCount,

            isUnlocked: idea.isUnlocked,

            creditBalanceAfter: creditResult?.balanceAfter ?? null,
          },
        },

        tx,
      );

      const savedIdea = await tx.idea.findUniqueOrThrow({
        where: {
          id: idea.id,
        },

        include: {
          domain: {
            select: {
              id: true,
              name: true,
            },
          },

          selectedPlatform: {
            select: {
              id: true,
              name: true,
            },
          },

          generatedOutputs: true,
        },
      });

      return {
        idea: savedIdea,

        creditResult,
      };
    });

    if (
      input.userId &&
      input.generationType === IdeaGenerationType.PREMIUM_CREDIT
    ) {
      await this.invalidateCachesSafely(input.userId);
    }

    return result;
  }

  /**
   * Consumes guest or registered free entitlement.
   *
   * Premium credit is consumed after Idea creation so that the
   * CreditTransaction can reference the final idea ID.
   */
  private async consumeNonCreditEntitlement(
    input: PersistIdeaInput,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    switch (input.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        if (!input.guestSessionId) {
          throw new ConflictException(
            'Guest session is required for guest generation.',
          );
        }

        await this.guestSessionService.consume(input.guestSessionId, tx);

        return;

      case IdeaGenerationType.NORMAL_FREE: {
        if (!input.userId) {
          throw new ConflictException(
            'Registered user is required for free generation.',
          );
        }

        const affectedRows = await tx.$executeRaw`
            UPDATE "users"
            SET "free_generations_used" =
                "free_generations_used" + 1
            WHERE "id" = ${input.userId}
              AND "role" = 'USER'
              AND "is_active" = true
              AND "is_verified" = true
              AND "free_generations_used" <
                  "free_generation_limit"
          `;

        if (affectedRows === 0) {
          throw new ConflictException('No free idea generations remain.');
        }

        return;
      }

      case IdeaGenerationType.PREMIUM_CREDIT:
        if (!input.userId) {
          throw new ConflictException(
            'Registered user is required for premium generation.',
          );
        }

        return;

      default:
        return this.assertNever(input.generationType);
    }
  }

  /**
   * Creates low-credit or exhausted-credit alerts.
   */
  private async createCreditAlertIfRequired(
    userId: string,
    balanceAfter: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (balanceAfter === 0) {
      await tx.alert.create({
        data: {
          userId,

          type: AlertType.CREDIT_EXHAUSTED,

          title: 'Credits exhausted',

          message:
            'Your credit balance is now zero. Purchase more credits to generate another premium idea.',
        },
      });

      return;
    }

    if (balanceAfter <= LOW_CREDIT_BALANCE_THRESHOLD) {
      await tx.alert.create({
        data: {
          userId,

          type: AlertType.CREDIT_LOW,

          title: 'Credit balance is low',

          message: `Your current credit balance is ${balanceAfter}.`,
        },
      });
    }
  }

  /**
   * Cache failure must not change a successful generation response
   * into an HTTP failure after the database transaction committed.
   */
  private async invalidateCachesSafely(userId: string): Promise<void> {
    try {
      await this.creditCacheService.invalidateUserCreditCaches(userId);
    } catch (error: unknown) {
      this.logger.warn(
        `Idea generation succeeded, but credit cache invalidation failed for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Builds the tier-specific Idea creation payload.
   */
  private buildIdeaCreateData(input: PersistIdeaInput): Prisma.IdeaCreateInput {
    const commonData = {
      title: input.aiOutput.title,

      domain: {
        connect: {
          id: input.domainId,
        },
      },

      collectionJob: {
        connect: {
          id: input.collectionJobId,
        },
      },

      ...(input.selectedPlatformId
        ? {
            selectedPlatform: {
              connect: {
                id: input.selectedPlatformId,
              },
            },
          }
        : {}),

      selectedRegion: input.selectedRegion ?? null,

      commentsCount: input.commentsCount,

      generationType: input.generationType,
    };

    switch (input.generationType) {
      case IdeaGenerationType.GUEST_FREE: {
        const output = input.aiOutput as GuestIdeaAiOutput;

        return {
          ...commonData,

          guestSession: {
            connect: {
              id: input.guestSessionId!,
            },
          },

          /**
           * Field exposed to the guest.
           */
          limitedAbstract: output.limitedAbstract,

          /**
           * Registered-user fields stored internally.
           *
           * The guest endpoint must never return them. They become
           * visible only after AuthGuestService transfers ownership.
           */
          problemStatement: output.problemStatement,

          objectives: output.objectives,

          targetUsers: output.targetUsers,

          partialAbstract: output.partialAbstract,

          isUnlocked: false,

          unlockMethod: UnlockMethod.NONE,
        };
      }

      case IdeaGenerationType.NORMAL_FREE: {
        const output = input.aiOutput as FreeIdeaAiOutput;

        return {
          ...commonData,

          user: {
            connect: {
              id: input.userId!,
            },
          },

          problemStatement: output.problemStatement,

          objectives: output.objectives,

          targetUsers: output.targetUsers,

          partialAbstract: output.partialAbstract,

          isUnlocked: false,

          unlockMethod: UnlockMethod.NONE,
        };
      }

      case IdeaGenerationType.PREMIUM_CREDIT: {
        const output = input.aiOutput as PremiumIdeaAiOutput;

        return {
          ...commonData,

          user: {
            connect: {
              id: input.userId!,
            },
          },

          problemStatement: output.problemStatement,

          objectives: output.objectives,

          targetUsers: output.targetUsers,

          fullAbstract: output.fullAbstract,

          isUnlocked: true,

          unlockMethod: UnlockMethod.CREDIT_GENERATION,

          unlockedAt: new Date(),
        };
      }

      default:
        return this.assertNever(input.generationType);
    }
  }

  private assertNever(value: never): never {
    throw new Error(`Unsupported idea generation type: ${String(value)}.`);
  }
}
