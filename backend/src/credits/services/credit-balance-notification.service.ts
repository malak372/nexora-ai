import { Injectable, Logger } from '@nestjs/common';
import { AlertType, UserRole } from '@prisma/client';

import { PushNotificationService } from '../../alerts/services/push-notification.service';
import { SystemAlertsService } from '../../alerts/services/system-alerts.service';
import { MailService } from '../../mail/mail.service';
import { GLOBAL_SYSTEM_SETTINGS_KEY } from '../../payments/constants/payment.constants';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Committed credit-balance change considered for user notification.
 */
export type CreditBalanceNotificationInput = {
  readonly userId: string;
  readonly previousBalance: number;
  readonly balanceAfter: number;
  /** Actual Premium-idea cost used by the committed generation, when known. */
  readonly referencePremiumIdeaCreditCost?: number;
};

type CreditBalanceNotificationKind = 'LOW' | 'EXHAUSTED';

/**
 * Sends credit-balance notifications only after the related database
 * transaction has committed successfully.
 *
 * Notification rules:
 * - The low-credit boundary is the database-backed number of credits required
 *   to generate one Premium idea.
 * - A positive balance at or below that cost is considered low after a
 *   deduction.
 * - A balance of zero is considered exhausted. CreditBalanceService also
 *   changes a Premium account to NORMAL at that boundary.
 * - Notification failures never roll back a committed credit operation.
 *
 * @author Malak
 * @author Eman
 */
@Injectable()
export class CreditBalanceNotificationService {
  private readonly logger = new Logger(CreditBalanceNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly systemAlertsService: SystemAlertsService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  /**
   * Sends the appropriate in-app alert and email for one committed balance
   * deduction.
   */
  async notifyAfterCommittedBalanceChange(
    input: CreditBalanceNotificationInput,
  ): Promise<void> {
    const isDeduction = input.balanceAfter < input.previousBalance;

    if (!isDeduction || input.balanceAfter < 0) {
      return;
    }

    try {
      /*
       * Premium generation passes the exact committed generation cost so the
       * low-credit boundary cannot drift if settings are edited between the
       * entitlement check and this post-commit notification. Other credit
       * mutation paths continue to resolve the current database-backed cost.
       */
      const referencedCost = this.normalizePositiveInteger(
        input.referencePremiumIdeaCreditCost,
      );
      const premiumIdeaCreditCost =
        referencedCost ?? (await this.getPremiumIdeaCreditCost());

      const notificationKind = this.resolveNotificationKind(
        input.balanceAfter,
        premiumIdeaCreditCost,
      );

      if (!notificationKind) {
        return;
      }

      const alert = this.buildAlert(
        input.userId,
        input.balanceAfter,
        premiumIdeaCreditCost,
        notificationKind,
      );

      /*
       * Persist the in-app alert before returning. This is the user-visible
       * source of truth and must not be a fire-and-forget side effect after a
       * successful Premium deduction. Email and push remain best-effort and do
       * not delay the committed credit operation.
       */
      await this.systemAlertsService.create(alert);

      void this.deliverSecondaryChannels(
        input.userId,
        input.balanceAfter,
        alert.title,
        alert.message,
        alert.type,
      ).catch((secondaryError: unknown) => {
        const secondaryMessage =
          secondaryError instanceof Error
            ? secondaryError.message
            : String(secondaryError);
        this.logger.warn(
          `Credit balance alert was persisted, but secondary notification delivery failed for user "${input.userId}": ${secondaryMessage}`,
        );
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Credit balance changed successfully, but balance notifications could not be prepared for user "${input.userId}": ${message}`,
      );
    }
  }

  /**
   * Sends non-critical notification channels after the in-app alert has been
   * durably persisted. Failures are logged and never affect the credit result.
   */
  private async deliverSecondaryChannels(
    userId: string,
    balanceAfter: number,
    title: string,
    message: string,
    type: AlertType,
  ): Promise<void> {
    const userPromise = this.prisma.user.findFirst({
      where: {
        id: userId,
        role: UserRole.USER,
        isActive: true,
        deletedAt: null,
      },
      select: { email: true },
    });

    const pushPromise = this.pushNotificationService.sendToUser({
      userId,
      title,
      body: message,
      data: {
        type: String(type),
        balanceAfter: String(balanceAfter),
      },
    });

    const emailPromise = userPromise.then((user) => {
      if (!user) {
        this.logger.warn(
          `Credit-balance email skipped because active user "${userId}" was not found.`,
        );
        return undefined;
      }

      return this.mailService.sendLowCreditBalanceEmail(
        user.email,
        balanceAfter,
      );
    });

    const results = await Promise.allSettled([pushPromise, emailPromise]);
    const labels = ['push notification', 'email'];

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const failureMessage =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

        this.logger.warn(
          `Credit balance alert was persisted, but the ${labels[index]} could not be sent to user "${userId}": ${failureMessage}`,
        );
      }
    });
  }

  private normalizePositiveInteger(value: number | undefined): number | null {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
  }

  /**
   * Reads the current Premium-generation credit cost from global settings.
   */
  private async getPremiumIdeaCreditCost(): Promise<number> {
    const settings = await this.prisma.systemSetting.findUnique({
      where: {
        key: GLOBAL_SYSTEM_SETTINGS_KEY,
      },
      select: {
        premiumIdeaCreditCost: true,
      },
    });

    const cost = Number(settings?.premiumIdeaCreditCost ?? 0);

    if (!Number.isInteger(cost) || cost <= 0) {
      this.logger.warn(
        'Low-credit notification skipped because premiumIdeaCreditCost is not configured with a positive integer.',
      );
      return 0;
    }

    return cost;
  }

  /**
   * Resolves whether the committed balance should be reported as low or
   * exhausted.
   */
  private resolveNotificationKind(
    balanceAfter: number,
    premiumIdeaCreditCost: number,
  ): CreditBalanceNotificationKind | null {
    if (balanceAfter === 0) {
      return 'EXHAUSTED';
    }

    if (
      premiumIdeaCreditCost > 0 &&
      balanceAfter > 0 &&
      balanceAfter <= premiumIdeaCreditCost
    ) {
      return 'LOW';
    }

    return null;
  }

  /**
   * Builds the user-facing in-app notification.
   */
  private buildAlert(
    userId: string,
    balanceAfter: number,
    premiumIdeaCreditCost: number,
    kind: CreditBalanceNotificationKind,
  ) {
    if (kind === 'EXHAUSTED') {
      return {
        userId,
        title: 'Premium credits exhausted',
        message:
          'Your credit balance reached 0, so your account is now Normal. Your previously generated and unlocked ideas remain available. To activate Premium again, purchase credits; the Premium activation fee will apply again.',
        type: AlertType.CREDIT_EXHAUSTED,
      };
    }

    const exactOneIdeaBalance = balanceAfter === premiumIdeaCreditCost;

    return {
      userId,
      title: 'Premium credits running low',
      message: exactOneIdeaBalance
        ? `You have ${balanceAfter} credits left, which is exactly the current ${premiumIdeaCreditCost}-credit cost of one Premium idea.`
        : `You have ${balanceAfter} credits left, which is below the current ${premiumIdeaCreditCost}-credit cost of one Premium idea. Add credits before your next Premium generation.`,
      type: AlertType.CREDIT_LOW,
    };
  }
}