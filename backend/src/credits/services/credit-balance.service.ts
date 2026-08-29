import { randomUUID } from 'node:crypto';

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
import { CreditCacheService } from './credit-cache.service';

/**
 * Central service responsible for credit-balance mutations.
 *
 * All credit additions and deductions must pass through this service.
 *
 * Credit mutations are performed atomically to prevent concurrent requests
 * from consuming the same balance.
 *
 * Account-status rules:
 * - A PREMIUM user becomes NORMAL when the balance reaches zero.
 * - A NORMAL user becomes PREMIUM only when activatePremium is explicitly true.
 * - Bonuses, refunds, and administrator adjustments do not activate Premium.
 *
 * Responsibilities:
 * - Validate the target user.
 * - Prevent negative balances.
 * - Update credit balances atomically.
 * - Deactivate Premium when the balance reaches zero.
 * - Explicitly activate Premium after an eligible successful purchase.
 * - Create CreditTransaction records.
 * - Participate in existing Prisma transactions.
 * - Invalidate credit caches after self-managed transactions.
 * - Trigger post-commit credit-balance notifications.
 *
 * This service does not:
 * - Expose HTTP endpoints.
 * - Process payment gateways.
 * - Calculate payment prices.
 * - Determine whether activation fees must be charged.
 * - Generate ideas.
 *
 * @author Malak
 */
@Injectable()
export class CreditBalanceService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly notificationService: CreditBalanceNotificationService,

    private readonly creditCacheService: CreditCacheService,
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
    this.validateAdjustmentInput(input);

    const execute = async (
      tx: Prisma.TransactionClient,
    ): Promise<CreditBalanceResult> => {
      const absoluteAmount = Math.abs(input.amount);
      const description = input.description?.trim() || null;

      /*
       * Deductions are the hot path for Premium idea generation. Start with
       * the conditional atomic decrement instead of reading the same user both
       * before and after the write. On success, one post-update read gives us
       * the authoritative balance and account status; the previous balance is
       * derived exactly from the applied delta.
       *
       * If the conditional decrement fails, only the error path performs the
       * extra lookup needed to distinguish missing/non-user accounts from an
       * insufficient balance. Concurrency protection remains identical because
       * the decrement condition is still enforced by the database.
       */
      if (input.amount < 0) {
        /*
         * Premium generation is the hottest credit path. Lock the target row,
         * apply the guarded decrement, and insert its immutable transaction
         * record in one PostgreSQL round trip. A second write is needed only
         * when the final credit deactivates PREMIUM, which is the rare path.
         */
        const transactionId = randomUUID();
        const rows = await tx.$queryRaw<Array<{
          previousBalance: number;
          balanceAfter: number;
          previousAccountStatus: AccountStatus;
          transactionId: string;
          transactionUserId: string;
          transactionPaymentId: string | null;
          transactionIdeaId: string | null;
          transactionPublicationAcceptanceId: string | null;
          transactionType: CreditTransactionType;
          transactionAmount: number;
          transactionBalanceAfter: number;
          transactionDescription: string | null;
          transactionCreatedAt: Date;
        }>>(Prisma.sql`
          WITH candidate AS (
            SELECT
              "id",
              "credit_balance",
              "account_status"
            FROM "users"
            WHERE "id" = ${input.userId}
              AND "role"::text = ${UserRole.USER}
            FOR UPDATE
          ),
          updated AS (
            UPDATE "users" AS user_row
            SET
              "credit_balance" = candidate."credit_balance" - ${absoluteAmount},
              "updated_at" = NOW()
            FROM candidate
            WHERE user_row."id" = candidate."id"
              AND candidate."credit_balance" >= ${absoluteAmount}
            RETURNING
              user_row."id",
              candidate."credit_balance" AS "previousBalance",
              user_row."credit_balance" AS "balanceAfter",
              candidate."account_status" AS "previousAccountStatus"
          ),
          inserted AS (
            INSERT INTO "credit_transactions" (
              "id",
              "user_id",
              "payment_id",
              "idea_id",
              "publication_acceptance_id",
              "type",
              "amount",
              "balance_after",
              "description",
              "created_at"
            )
            SELECT
              ${transactionId},
              updated."id",
              ${input.paymentId ?? null},
              ${input.ideaId ?? null},
              ${input.publicationAcceptanceId ?? null},
              CAST(${input.type} AS "CreditTransactionType"),
              ${input.amount},
              updated."balanceAfter",
              ${description},
              NOW()
            FROM updated
            RETURNING
              "id",
              "user_id",
              "payment_id",
              "idea_id",
              "publication_acceptance_id",
              "type",
              "amount",
              "balance_after",
              "description",
              "created_at"
          )
          SELECT
            updated."previousBalance",
            updated."balanceAfter",
            updated."previousAccountStatus",
            inserted."id" AS "transactionId",
            inserted."user_id" AS "transactionUserId",
            inserted."payment_id" AS "transactionPaymentId",
            inserted."idea_id" AS "transactionIdeaId",
            inserted."publication_acceptance_id" AS "transactionPublicationAcceptanceId",
            inserted."type" AS "transactionType",
            inserted."amount" AS "transactionAmount",
            inserted."balance_after" AS "transactionBalanceAfter",
            inserted."description" AS "transactionDescription",
            inserted."created_at" AS "transactionCreatedAt"
          FROM updated
          INNER JOIN inserted ON inserted."user_id" = updated."id"
          LIMIT 1
        `);

        const row = rows[0];
        if (!row) {
          const failedUser = await tx.user.findUnique({
            where: { id: input.userId },
            select: { id: true, role: true },
          });

          if (!failedUser) {
            throw new NotFoundException('User not found.');
          }
          if (failedUser.role !== UserRole.USER) {
            throw new BadRequestException(
              'Credits can only be changed for user accounts.',
            );
          }
          throw new BadRequestException('Insufficient credit balance.');
        }

        let accountStatus = row.previousAccountStatus;
        if (
          row.balanceAfter === 0 &&
          row.previousAccountStatus === AccountStatus.PREMIUM
        ) {
          await tx.user.update({
            where: { id: input.userId },
            data: { accountStatus: AccountStatus.NORMAL },
          });
          accountStatus = AccountStatus.NORMAL;
        }

        return {
          previousBalance: row.previousBalance,
          balanceAfter: row.balanceAfter,
          previousAccountStatus: row.previousAccountStatus,
          accountStatus,
          transaction: {
            id: row.transactionId,
            userId: row.transactionUserId,
            paymentId: row.transactionPaymentId,
            ideaId: row.transactionIdeaId,
            publicationAcceptanceId: row.transactionPublicationAcceptanceId,
            type: row.transactionType,
            amount: row.transactionAmount,
            balanceAfter: row.transactionBalanceAfter,
            description: row.transactionDescription,
            createdAt: row.transactionCreatedAt,
          },
        };
      }

      const user = await tx.user.findUnique({
        where: { id: input.userId },
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

      await this.addCreditsAtomically(tx, user.id, absoluteAmount);

      const updatedUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { creditBalance: true },
      });

      if (!updatedUser) {
        throw new NotFoundException(
          'User not found after credit balance update.',
        );
      }

      const balanceAfter = updatedUser.creditBalance;
      const previousBalance = balanceAfter - input.amount;
      const accountStatus = this.resolveAccountStatus({
        previousStatus: user.accountStatus,
        balanceAfter,
        activatePremium: input.activatePremium === true,
      });

      if (user.accountStatus !== accountStatus) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            accountStatus,
            ...(accountStatus === AccountStatus.PREMIUM &&
              input.activatePremium === true && {
                premiumActivatedAt: new Date(),
              }),
          },
        });
      }

      const transaction = await tx.creditTransaction.create({
        data: {
          userId: user.id,
          paymentId: input.paymentId ?? null,
          ideaId: input.ideaId ?? null,
          publicationAcceptanceId: input.publicationAcceptanceId ?? null,
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

    /*
     * When the caller supplies a transaction, cache invalidation and
     * notifications must be handled by that caller after the transaction
     * successfully commits.
     */
    if (input.tx) {
      return execute(input.tx);
    }

    const result = await this.prisma.$transaction(execute);

    /*
     * These operations run only after the database transaction commits.
     */
    await this.creditCacheService.invalidateUserCreditCaches(input.userId);

    await this.notificationService.notifyAfterCommittedBalanceChange({
      userId: input.userId,
      previousBalance: result.previousBalance,
      balanceAfter: result.balanceAfter,
      ...(input.type === CreditTransactionType.DEDUCTION_GENERATION && {
        referencePremiumIdeaCreditCost: Math.abs(input.amount),
      }),
    });

    return result;
  }

  /**
   * Consumes credits for one Premium idea generation.
   *
   * If this deduction consumes the user's final credit, the account
   * automatically returns to NORMAL.
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
      description: 'Credit deducted for Premium idea generation.',
      activatePremium: false,
      tx,
    });
  }

  /**
   * Consumes credits to unlock advanced outputs for an accepted publication.
   *
   * If this deduction consumes the final credit, the account returns
   * to NORMAL.
   */
  consumeForPublicationAdvancedUnlock(
    userId: string,
    publicationAcceptanceId: string,
    amount: number,
    tx?: Prisma.TransactionClient,
  ): Promise<CreditBalanceResult> {
    if (amount <= 0) {
      throw new BadRequestException(
        'Publication unlock credit amount must be greater than zero.',
      );
    }

    return this.adjustBalance({
      userId,
      publicationAcceptanceId,
      amount: -amount,
      type: CreditTransactionType.DEDUCTION_PUBLICATION_ADVANCED,
      description: 'Credit deducted to unlock advanced publication outputs.',
      activatePremium: false,
      tx,
    });
  }

  /**
   * Validates rules that apply to all balance adjustments.
   */
  private validateAdjustmentInput(input: AdjustCreditBalanceInput): void {
    if (!Number.isInteger(input.amount)) {
      throw new BadRequestException(
        'Credit adjustment amount must be an integer.',
      );
    }

    if (input.amount === 0) {
      throw new BadRequestException('Credit adjustment amount cannot be zero.');
    }

    if (input.activatePremium === true && input.amount <= 0) {
      throw new BadRequestException(
        'Premium activation requires a positive credit adjustment.',
      );
    }

    if (
      input.activatePremium === true &&
      input.type !== CreditTransactionType.PURCHASE
    ) {
      throw new BadRequestException(
        'Premium can only be activated through a credit purchase.',
      );
    }

    if (input.activatePremium === true && !input.paymentId) {
      throw new BadRequestException(
        'Premium activation requires a related payment.',
      );
    }
  }

  /**
   * Performs an atomic credit deduction.
   */
  private async deductCreditsAtomically(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
  ): Promise<void> {
    const deductionResult = await tx.user.updateMany({
      where: {
        id: userId,
        role: UserRole.USER,
        creditBalance: {
          gte: amount,
        },
      },
      data: {
        creditBalance: {
          decrement: amount,
        },
      },
    });

    if (deductionResult.count === 0) {
      throw new BadRequestException('Insufficient credit balance.');
    }
  }

  /**
   * Performs an atomic credit addition.
   */
  private async addCreditsAtomically(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
  ): Promise<void> {
    const additionResult = await tx.user.updateMany({
      where: {
        id: userId,
        role: UserRole.USER,
      },
      data: {
        creditBalance: {
          increment: amount,
        },
      },
    });

    if (additionResult.count === 0) {
      throw new BadRequestException(
        'Unable to update the user credit balance.',
      );
    }
  }

  /**
   * Resolves the account status after a credit-balance change.
   *
   * Rules:
   * - A zero balance always produces NORMAL.
   * - Explicit activation produces PREMIUM when the balance is positive.
   * - Otherwise, the current account status remains unchanged.
   */
  private resolveAccountStatus(input: {
    previousStatus: AccountStatus;
    balanceAfter: number;
    activatePremium: boolean;
  }): AccountStatus {
    if (input.balanceAfter === 0) {
      return AccountStatus.NORMAL;
    }

    if (input.activatePremium) {
      return AccountStatus.PREMIUM;
    }

    return input.previousStatus;
  }
}