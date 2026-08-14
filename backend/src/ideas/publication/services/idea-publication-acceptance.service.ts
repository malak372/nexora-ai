import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AccountStatus,
  AlertType,
  AuditAction,
  AuditTargetType,
  IdeaAdoptionMode,
  IdeaPublicationStatus,
  Prisma,
  PublicationAdvancedUnlockMethod,
} from '@prisma/client';

import { SystemAlertsService } from '../../../alerts/services/system-alerts.service';
import { AuditService } from '../../../audit-logs/audit-logs.service';
import { CreditBalanceNotificationService } from '../../../credits/services/credit-balance-notification.service';
import { CreditBalanceService } from '../../../credits/services/credit-balance.service';
import { CreditCacheService } from '../../../credits/services/credit-cache.service';
import { GLOBAL_SYSTEM_SETTINGS_KEY } from '../../../payments/constants/payment.constants';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Payment data required to fulfill a paid publication acceptance
 * for a NORMAL user.
 */
type NormalPublicationAcceptancePayment = {
  readonly id: string;
  readonly userId: string;
  readonly publicationId: string | null;
  readonly acceptanceCountry: string | null;
  readonly acceptanceCity: string | null;
  readonly acceptanceRegion: string | null;
  readonly clientRequestId: string | null;
};

/**
 * Publication fields required to validate its current
 * acceptance capacity.
 */
type PublicationCapacityData = {
  readonly maximumAdoptions: number | null;
  readonly adoptionMode: IdeaAdoptionMode;
};

/**
 * Manages user acceptance of published ideas.
 *
 * Responsibilities:
 * - Allow Premium users to accept basic publication details for free.
 * - Allow Premium users to unlock advanced publication details using credits.
 * - Fulfill paid publication acceptances for Normal users.
 * - Prevent users from accepting their own publications.
 * - Enforce exclusive and limited publication-adoption rules.
 * - Preserve idempotency for repeated acceptance requests.
 * - Create audit records for acceptance and advanced unlocking.
 * - Notify publishers when their publications are accepted.
 *
 * This service does not:
 * - Create payment checkout sessions.
 * - Verify payment-provider webhooks.
 * - Mark payments as successful.
 * - Publish or archive ideas.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPublicationAcceptanceService {
  private readonly logger = new Logger(IdeaPublicationAcceptanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditBalanceService: CreditBalanceService,
    private readonly creditBalanceNotificationService: CreditBalanceNotificationService,
    private readonly creditCacheService: CreditCacheService,
    private readonly alerts: SystemAlertsService,
    private readonly audit: AuditService,
  ) { }

  /**
   * Accepts the basic details of a publication for a Premium user.
   *
   * Premium users can accept the basic publication snapshot without
   * making a direct payment. The user's preferred location is stored
   * with the acceptance when available.
   *
   * @param userId Authenticated user identifier.
   * @param publicationId Publication identifier.
   * @param clientRequestId Client-generated idempotency identifier.
   * @returns Existing or newly created publication acceptance.
   *
   * @throws NotFoundException When the user or publication does not exist.
   * @throws ForbiddenException When the user is not Premium or owns the publication.
   * @throws ConflictException When the publication reached its acceptance limit.
   */
  async acceptBasicForPremium(
    userId: string,
    publicationId: string,
    clientRequestId: string,
  ) {
    const normalizedClientRequestId = clientRequestId.trim();

    if (!normalizedClientRequestId) {
      throw new BadRequestException(
        'A valid client request identifier is required.',
      );
    }

    const [user, publication] = await Promise.all([
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          accountStatus: true,
          preference: {
            select: {
              preferredCountry: true,
              preferredCity: true,
              preferredRegion: true,
            },
          },
        },
      }),
      this.getAcceptablePublication(publicationId),
    ]);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.accountStatus !== AccountStatus.PREMIUM) {
      throw new ForbiddenException(
        'Only Premium users can accept basic publication details for free.',
      );
    }

    this.assertNotOwner(publication.publisherId, userId);

    return this.prisma.$transaction(async (tx) => {
      /*
       * Return the previously created acceptance when the client
       * safely retries the same request.
       */
      const existingByRequest = await tx.ideaPublicationAcceptance.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: normalizedClientRequestId,
          },
        },
      });

      if (existingByRequest) {
        return existingByRequest;
      }

      /*
       * Return the existing publication acceptance without checking
       * capacity again. A user must not consume more than one slot.
       */
      const existingByPublication =
        await tx.ideaPublicationAcceptance.findUnique({
          where: {
            publicationId_userId: {
              publicationId,
              userId,
            },
          },
        });

      if (existingByPublication) {
        return existingByPublication;
      }

      await this.assertCapacity(publicationId, publication, tx);

      const acceptance = await tx.ideaPublicationAcceptance.create({
        data: {
          publicationId,
          userId,
          clientRequestId: normalizedClientRequestId,
          country: user.preference?.preferredCountry ?? null,
          city: user.preference?.preferredCity ?? null,
          region: user.preference?.preferredRegion ?? null,
        },
      });

      await this.audit.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_ACCEPT_PUBLICATION,
          targetType: AuditTargetType.IDEA_PUBLICATION_ACCEPTANCE,
          targetId: acceptance.id,
        },
        tx,
      );

      await this.alerts.create(
        {
          userId: publication.publisherId,
          title: 'Idea accepted',
          message: user.preference?.preferredCity
            ? `Your published idea was accepted by a user from ${user.preference.preferredCity}.`
            : 'Your published idea was accepted.',
          type: AlertType.SYSTEM,
        },
        tx,
      );

      return acceptance;
    });
  }

  /**
   * Unlocks advanced publication details for a Premium user.
   *
   * The user must first accept the publication. The configured number
   * of credits is consumed atomically with the advanced-access update.
   *
   * @param userId Authenticated user identifier.
   * @param publicationId Publication identifier.
   * @returns Updated publication acceptance.
   *
   * @throws NotFoundException When the user or acceptance does not exist.
   * @throws ForbiddenException When the user is not currently Premium.
   * @throws BadRequestException When the publication was not accepted or
   * the configured credit cost is invalid.
   */
  async unlockAdvancedForPremium(userId: string, publicationId: string) {
    const [user, acceptance, settings] = await Promise.all([
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          accountStatus: true,
          creditBalance: true,
        },
      }),
      this.prisma.ideaPublicationAcceptance.findUnique({
        where: {
          publicationId_userId: {
            publicationId,
            userId,
          },
        },
        include: {
          publication: {
            select: {
              ideaId: true,
            },
          },
        },
      }),
      this.prisma.systemSetting.findUnique({
        where: {
          key: GLOBAL_SYSTEM_SETTINGS_KEY,
        },
        select: {
          publicationAdvancedCreditCost: true,
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.accountStatus !== AccountStatus.PREMIUM) {
      throw new ForbiddenException(
        'Advanced details require an active Premium account.',
      );
    }

    if (!acceptance) {
      throw new BadRequestException(
        'Accept the publication before unlocking advanced details.',
      );
    }

    if (acceptance.advancedUnlockedAt) {
      return {
        acceptance,
        creditBalance: user.creditBalance,
        accountStatus: user.accountStatus,
        creditsSpent: 0,
      };
    }

    const availableAdvancedOutputs =
      await this.prisma.generatedOutput.count({
        where: {
          ideaId: acceptance.publication.ideaId,
          status: 'COMPLETED',
        },
      });

    if (availableAdvancedOutputs <= 0) {
      throw new BadRequestException(
        'This publication does not contain advanced outputs to unlock.',
      );
    }

    if (
      !settings ||
      !Number.isInteger(settings.publicationAdvancedCreditCost) ||
      settings.publicationAdvancedCreditCost <= 0
    ) {
      throw new BadRequestException(
        'Invalid publication advanced credit cost.',
      );
    }

    const transactionResult = await this.prisma.$transaction(async (tx) => {
      const freshAcceptance = await tx.ideaPublicationAcceptance.findUnique({
        where: {
          id: acceptance.id,
        },
      });

      if (!freshAcceptance) {
        throw new NotFoundException('Publication acceptance not found.');
      }

      if (freshAcceptance.advancedUnlockedAt) {
        const currentUser = await tx.user.findUnique({
          where: { id: userId },
          select: {
            creditBalance: true,
            accountStatus: true,
          },
        });

        return {
          response: {
            acceptance: freshAcceptance,
            creditBalance: currentUser?.creditBalance ?? user.creditBalance,
            accountStatus: currentUser?.accountStatus ?? user.accountStatus,
            creditsSpent: 0,
          },
          creditChange: null,
        };
      }

      const creditResult =
        await this.creditBalanceService.consumeForPublicationAdvancedUnlock(
          userId,
          freshAcceptance.id,
          settings.publicationAdvancedCreditCost,
          tx,
        );

      const updatedAcceptance = await tx.ideaPublicationAcceptance.update({
        where: {
          id: freshAcceptance.id,
        },
        data: {
          advancedUnlockedAt: new Date(),
          advancedUnlockMethod: PublicationAdvancedUnlockMethod.PREMIUM_CREDIT,
        },
      });

      await this.audit.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_UNLOCK_PUBLICATION_ADVANCED,
          targetType: AuditTargetType.IDEA_PUBLICATION_ACCEPTANCE,
          targetId: updatedAcceptance.id,
        },
        tx,
      );

      return {
        response: {
          acceptance: updatedAcceptance,
          creditBalance: creditResult.balanceAfter,
          accountStatus: creditResult.accountStatus,
          creditsSpent: settings.publicationAdvancedCreditCost,
        },
        creditChange: {
          previousBalance: creditResult.previousBalance,
          balanceAfter: creditResult.balanceAfter,
        },
      };
    }, {
      maxWait: 10_000,
      timeout: 20_000,
    });

    if (transactionResult.creditChange) {
      void Promise.allSettled([
        this.creditCacheService.invalidateUserCreditCaches(userId),
        this.creditBalanceNotificationService.notifyAfterCommittedBalanceChange({
          userId,
          previousBalance: transactionResult.creditChange.previousBalance,
          balanceAfter: transactionResult.creditChange.balanceAfter,
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);

            this.logger.warn(
              `Publication advanced unlock committed, but a credit side effect failed for user "${userId}": ${message}`,
            );
          }
        }
      });
    }

    return transactionResult.response;
  }

  /**
   * Fulfills a successfully paid publication acceptance for a
   * Normal user.
   *
   * Direct payment creates the basic publication acceptance only.
   * Advanced outputs remain locked until a separate payment or Premium credit unlock.
   *
   * The supplied transaction is controlled by PaymentProcessingService,
   * so payment completion and acceptance creation remain atomic.
   *
   * @param payment Successful publication-acceptance payment.
   * @param tx Active Prisma transaction.
   * @returns Created or updated publication acceptance.
   *
   * @throws BadRequestException When the payment does not reference a
   * publication or the publication is unavailable.
   * @throws NotFoundException When the publication does not exist.
   * @throws ForbiddenException When the user owns the publication.
   * @throws ConflictException When the publication reached its acceptance limit.
   */
  async fulfillNormalAcceptance(
    payment: NormalPublicationAcceptancePayment,
    tx: Prisma.TransactionClient,
  ) {
    if (!payment.publicationId) {
      throw new BadRequestException('Acceptance payment has no publication.');
    }

    const publication = await tx.ideaPublication.findUnique({
      where: {
        id: payment.publicationId,
      },
      select: {
        publisherId: true,
        status: true,
        isHidden: true,
        allowAdoption: true,
        maximumAdoptions: true,
        adoptionMode: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found.');
    }

    if (
      publication.status !== IdeaPublicationStatus.PUBLISHED ||
      publication.isHidden ||
      !publication.allowAdoption
    ) {
      throw new BadRequestException(
        'Publication is not available for acceptance.',
      );
    }

    this.assertNotOwner(publication.publisherId, payment.userId);

    const existingAcceptance = await tx.ideaPublicationAcceptance.findUnique({
      where: {
        publicationId_userId: {
          publicationId: payment.publicationId,
          userId: payment.userId,
        },
      },
    });

    if (existingAcceptance) {
      return existingAcceptance;
    }

    await this.assertCapacity(payment.publicationId, publication, tx);

    const clientRequestId = payment.clientRequestId?.trim() || payment.id;

    const acceptance = await tx.ideaPublicationAcceptance.create({
      data: {
        publicationId: payment.publicationId,
        userId: payment.userId,
        clientRequestId,
        paymentId: payment.id,
        country: payment.acceptanceCountry,
        city: payment.acceptanceCity,
        region: payment.acceptanceRegion,
      },
    });

    await this.audit.createLog(
      {
        actorId: payment.userId,
        action: AuditAction.USER_ACCEPT_PUBLICATION,
        targetType: AuditTargetType.IDEA_PUBLICATION_ACCEPTANCE,
        targetId: acceptance.id,
      },
      tx,
    );

    await this.alerts.create(
      {
        userId: publication.publisherId,
        title: 'Idea accepted',
        message: payment.acceptanceCity
          ? `Your published idea was accepted by a user from ${payment.acceptanceCity}.`
          : 'Your published idea was accepted.',
        type: AlertType.PAYMENT,
      },
      tx,
    );

    return acceptance;
  }

  /**
   * Fulfills a verified direct payment for advanced publication outputs.
   *
   * The basic acceptance must already exist. The update is idempotent and the
   * payment is attached separately from the original acceptance payment.
   */
  async fulfillNormalAdvancedUnlock(
    payment: {
      readonly id: string;
      readonly userId: string;
      readonly publicationId: string | null;
    },
    tx: Prisma.TransactionClient,
  ) {
    if (!payment.publicationId) {
      throw new BadRequestException(
        'Advanced publication payment has no publication.',
      );
    }

    const acceptance = await tx.ideaPublicationAcceptance.findUnique({
      where: {
        publicationId_userId: {
          publicationId: payment.publicationId,
          userId: payment.userId,
        },
      },
    });

    if (!acceptance) {
      throw new BadRequestException(
        'Accept the publication before unlocking advanced outputs.',
      );
    }

    if (acceptance.advancedUnlockedAt) {
      return acceptance;
    }

    const updatedAcceptance = await tx.ideaPublicationAcceptance.update({
      where: { id: acceptance.id },
      data: {
        advancedPaymentId: payment.id,
        advancedUnlockedAt: new Date(),
        advancedUnlockMethod: PublicationAdvancedUnlockMethod.DIRECT_PAYMENT,
      },
    });

    await this.audit.createLog(
      {
        actorId: payment.userId,
        action: AuditAction.USER_UNLOCK_PUBLICATION_ADVANCED,
        targetType: AuditTargetType.IDEA_PUBLICATION_ACCEPTANCE,
        targetId: updatedAcceptance.id,
      },
      tx,
    );

    return updatedAcceptance;
  }

  /**
   * Returns the authenticated user's acceptance state for
   * one publication.
   *
   * @param userId Authenticated user identifier.
   * @param publicationId Publication identifier.
   */
  getMyAcceptance(userId: string, publicationId: string) {
    return this.prisma.ideaPublicationAcceptance.findUnique({
      where: {
        publicationId_userId: {
          publicationId,
          userId,
        },
      },
      select: {
        id: true,
        acceptedAt: true,
        advancedUnlockedAt: true,
        advancedUnlockMethod: true,
        advancedPaymentId: true,
        paymentId: true,
      },
    });
  }

  /**
   * Retrieves one active publication that currently allows adoption.
   *
   * @param publicationId Publication identifier.
   * @throws NotFoundException When the publication is unavailable.
   */
  private async getAcceptablePublication(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        status: IdeaPublicationStatus.PUBLISHED,
        isHidden: false,
        allowAdoption: true,
      },
      select: {
        id: true,
        publisherId: true,
        maximumAdoptions: true,
        adoptionMode: true,
      },
    });

    if (!publication) {
      throw new NotFoundException(
        'Publication not found or adoption is disabled.',
      );
    }

    return publication;
  }

  /**
   * Ensures that a publication has not reached its adoption limit.
   *
   * Exclusive publications allow one acceptance. Non-exclusive
   * publications use maximumAdoptions when configured.
   *
   * @param publicationId Publication identifier.
   * @param publication Publication capacity configuration.
   * @param tx Prisma service or active transaction.
   */
  private async assertCapacity(
    publicationId: string,
    publication: PublicationCapacityData,
    tx: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    const acceptanceCount = await tx.ideaPublicationAcceptance.count({
      where: {
        publicationId,
      },
    });

    const acceptanceLimit =
      publication.adoptionMode === IdeaAdoptionMode.EXCLUSIVE
        ? 1
        : publication.maximumAdoptions;

    if (acceptanceLimit !== null && acceptanceCount >= acceptanceLimit) {
      throw new ConflictException(
        'This publication reached its acceptance limit.',
      );
    }
  }

  /**
   * Prevents a publisher from accepting their own publication.
   */
  private assertNotOwner(publisherId: string, userId: string): void {
    if (publisherId === userId) {
      throw new ForbiddenException('You cannot accept your own publication.');
    }
  }
}