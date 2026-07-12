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

/**
 * Central service responsible for credit-balance mutations.
 *
 * All credit additions and deductions must pass through this service.
 *
 * Responsibilities:
 * - Validate the target user.
 * - Prevent negative balances.
 * - Update credit balance.
 * - Update account status.
 * - Create CreditTransaction records.
 * - Participate in existing Prisma transactions.
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
  ) {}

  /**
   * Changes one user's credit balance.
   */
  async adjustBalance(
    input: AdjustCreditBalanceInput,
  ): Promise<CreditBalanceResult> {
    if (input.amount === 0) {
      throw new BadRequestException(
        'Credit adjustment amount cannot be zero.',
      );
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
        throw new NotFoundException(
          'User not found.',
        );
      }

      if (user.role !== UserRole.USER) {
        throw new BadRequestException(
          'Credits can only be changed for user accounts.',
        );
      }

      const balanceAfter =
        user.creditBalance + input.amount;

      if (balanceAfter < 0) {
        throw new BadRequestException(
          'Credit balance cannot be negative.',
        );
      }

      const accountStatus =
        balanceAfter > 0
          ? AccountStatus.PREMIUM
          : AccountStatus.NORMAL;

      await tx.user.update({
        where: {
          id: user.id,
        },

        data: {
          creditBalance: balanceAfter,
          accountStatus,
        },
      });

      const transaction =
        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            paymentId: input.paymentId ?? null,
            ideaId: input.ideaId ?? null,
            type: input.type,
            amount: input.amount,
            balanceAfter,
            description:
              input.description?.trim() ?? null,
          },
        });

      return {
        previousBalance: user.creditBalance,
        balanceAfter,
        previousAccountStatus:
          user.accountStatus,
        accountStatus,
        transaction,
      };
    };

    if (input.tx) {
      return execute(input.tx);
    }

    return this.prisma.$transaction(execute);
  }

  /**
   * Consumes credits for one premium idea generation.
   */
  consumeForIdeaGeneration(
  userId: string,
  ideaId: string,
  amount: number,
  tx?: Prisma.TransactionClient,
) {
  return this.adjustBalance({
    userId,
    ideaId,
    amount: -Math.abs(amount),
    type: CreditTransactionType.DEDUCTION_GENERATION,
    description:
      'Credit deducted for premium idea generation.',
    tx,
  });
}
}