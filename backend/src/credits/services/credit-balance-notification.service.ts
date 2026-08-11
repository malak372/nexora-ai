import { Injectable, Logger } from '@nestjs/common';
import { AlertType, UserRole } from '@prisma/client';

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
      const [user, premiumIdeaCreditCost] = await Promise.all([
        this.prisma.user.findFirst({
          where: {
            id: input.userId,
            role: UserRole.USER,
            isActive: true,
            deletedAt: null,
          },
          select: {
            email: true,
          },
        }),
        this.getPremiumIdeaCreditCost(),
      ]);

      if (!user) {
        this.logger.warn(
          `Credit-balance notification skipped because active user "${input.userId}" was not found.`,
        );
        return;
      }

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

      const results = await Promise.allSettled([
        this.systemAlertsService.create(alert),
        this.mailService.sendLowCreditBalanceEmail(
          user.email,
          input.balanceAfter,
        ),
      ]);

      const labels = ['in-app alert', 'email'];

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);

          this.logger.warn(
            `Credit balance changed successfully, but the ${labels[index]} could not be sent to user "${input.userId}": ${message}`,
          );
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Credit balance changed successfully, but balance notifications could not be prepared for user "${input.userId}": ${message}`,
      );
    }
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