import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

import { LOW_CREDIT_BALANCE_THRESHOLD } from '../constants/credit.constants';

/**
 * Committed credit-balance change considered for user notification.
 */
export type CreditBalanceNotificationInput = {
  readonly userId: string;
  readonly previousBalance: number;
  readonly balanceAfter: number;
};

/**
 * Sends credit-balance emails only after the related database transaction
 * has committed successfully.
 *
 * Notification rules:
 * - A low-balance email is sent once when a deduction crosses from above the
 *   configured threshold to a positive balance at or below the threshold.
 * - An exhausted-balance email is sent once when a positive balance reaches
 *   zero.
 * - Additional deductions while the balance remains inside the low range do
 *   not resend the low-balance email.
 * - Notification failures are logged and never roll back committed credit or
 *   idea operations.
 *
 * @author Malak
 */
@Injectable()
export class CreditBalanceNotificationService {
  private readonly logger = new Logger(
    CreditBalanceNotificationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Sends the appropriate email for one committed balance change.
   */
  async notifyAfterCommittedBalanceChange(
    input: CreditBalanceNotificationInput,
  ): Promise<void> {
    if (!this.shouldSendNotification(input)) {
      return;
    }

    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: input.userId,
          role: UserRole.USER,
          isActive: true,
          deletedAt: null,
        },
        select: {
          email: true,
        },
      });

      if (!user) {
        this.logger.warn(
          `Credit-balance notification skipped because active user "${input.userId}" was not found.`,
        );
        return;
      }

      await this.mailService.sendLowCreditBalanceEmail(
        user.email,
        input.balanceAfter,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Credit balance changed successfully, but the balance email could not be sent to user "${input.userId}": ${message}`,
      );
    }
  }

  /**
   * Determines whether one deduction crossed a notification boundary.
   */
  private shouldSendNotification(
    input: CreditBalanceNotificationInput,
  ): boolean {
    const isDeduction = input.balanceAfter < input.previousBalance;

    if (!isDeduction || input.balanceAfter < 0) {
      return false;
    }

    const crossedLowBalanceThreshold =
      input.previousBalance > LOW_CREDIT_BALANCE_THRESHOLD &&
      input.balanceAfter > 0 &&
      input.balanceAfter <= LOW_CREDIT_BALANCE_THRESHOLD;

    const becameExhausted =
      input.previousBalance > 0 && input.balanceAfter === 0;

    return crossedLowBalanceThreshold || becameExhausted;
  }
}