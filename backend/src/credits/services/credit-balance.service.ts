import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AccountStatus,
  CreditTransactionType,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { AdjustCreditBalanceInput } from '../types/adjust-credit-balance-input.type';
import type { CreditBalanceResult } from '../types/credit-balance-result.type';

import { CreditBalanceNotificationService } from './credit-balance-notification.service';

/**
 * Central service responsible for credit-balance mutations.
 *
 * All credit additions and deductions must pass through this service.
 *
 * Credit mutations are performed atomically to prevent concurrent requests
 * from consuming the same balance.
 *
 * Responsibilities:
 * - Validate the target user.
 * - Prevent negative balances.
 * - Update credit balance atomically.
 * - Update account status.
 * - Create CreditTransaction records.
 * - Participate in existing Prisma transactions.
 * - Trigger post-commit balance notification checks for self-managed
 *   transactions.
 *
 * This service does not:
 * - Expose HTTP endpoints.
 * - Process payment gateways.
 * - Generate ideas.
 * - Perform administrator analytics.
 *
 * @author Malak
 */
@Injectable()
export class CreditBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: CreditBalanceNotificationService,
  ) {}

  /**
   * Changes one user's credit balance.
   *
   * Negative adjustments use a conditional atomic decrement so concurrent
   * requests cannot consume more credits than the user owns.
   *
   * Positive adjustments use Prisma's atomic increment operation.
   */
  async adjustBalance(
    input: AdjustCreditBalanceInput,
  ): Promise<CreditBalanceResult> {
    if (input.amount === 0) {
      throw new BadRequestException('Credit adjustment amount cannot be zero.');
    }

    const execute = async (
      tx: Prisma.TransactionClient,
    ): Promise<CreditBalanceResult> => {
      const user = await tx.user.findUnique({
        where: {
          id: input.userId,
        },

        select: {
          id: true,
          role: true,
          creditBalance: true,
          accountStatus: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      if (user.role !== UserRole.USER) {
        throw new BadRequestException(
          'Credits can only be changed for user accounts.',
        );
      }

      const absoluteAmount = Math.abs(input.amount);
      const description = input.description?.trim() ?? null;

      if (input.amount < 0) {
        const deductionResult = await tx.user.updateMany({
          where: {
            id: user.id,
            role: UserRole.USER,

            creditBalance: {
              gte: absoluteAmount,
            },
          },

          data: {
            creditBalance: {
              decrement: absoluteAmount,
            },
          },
        });

        if (deductionResult.count === 0) {
          throw new BadRequestException('Insufficient credit balance.');
        }
      } else {
        const additionResult = await tx.user.updateMany({
          where: {
            id: user.id,
            role: UserRole.USER,
          },

          data: {
            creditBalance: {
              increment: absoluteAmount,
            },
          },
        });

        if (additionResult.count === 0) {
          throw new BadRequestException(
            'Unable to update the user credit balance.',
          );
        }
      }

      const updatedUser = await tx.user.findUnique({
        where: {
          id: user.id,
        },

        select: {
          creditBalance: true,
        },
      });

      if (!updatedUser) {
        throw new NotFoundException(
          'User not found after credit balance update.',
        );
      }

      const balanceAfter = updatedUser.creditBalance;

      const previousBalance = balanceAfter - input.amount;

      const accountStatus =
        balanceAfter > 0 ? AccountStatus.PREMIUM : AccountStatus.NORMAL;

      if (user.accountStatus !== accountStatus) {
        await tx.user.update({
          where: {
            id: user.id,
          },

          data: {
            accountStatus,
          },
        });
      }

      const transaction = await tx.creditTransaction.create({
        data: {
          userId: user.id,
          paymentId: input.paymentId ?? null,
          ideaId: input.ideaId ?? null,
          type: input.type,
          amount: input.amount,
          balanceAfter,
          description,
        },
      });

      return {
        previousBalance,
        balanceAfter,
        previousAccountStatus: user.accountStatus,
        accountStatus,
        transaction,
      };
    };

    if (input.tx) {
      return execute(input.tx);
    }

    const result = await this.prisma.$transaction(execute);

    await this.notificationService.notifyAfterCommittedBalanceChange({
      userId: input.userId,
      previousBalance: result.previousBalance,
      balanceAfter: result.balanceAfter,
    });

    return result;
  }

  /**
   * Consumes credits for one premium idea generation.
   *
   * The deduction is executed atomically, preventing simultaneous premium
   * generation requests from consuming the same available credits.
   */
  consumeForIdeaGeneration(
    userId: string,
    ideaId: string,
    amount: number,
    tx?: Prisma.TransactionClient,
  ): Promise<CreditBalanceResult> {
    if (amount <= 0) {
      throw new BadRequestException(
        'Idea generation credit amount must be greater than zero.',
      );
    }

    return this.adjustBalance({
      userId,
      ideaId,
      amount: -amount,
      type: CreditTransactionType.DEDUCTION_GENERATION,
      description: 'Credit deducted for premium idea generation.',
      tx,
    });
  }
}