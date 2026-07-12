import {
  AccountStatus,
  CreditTransaction,
} from '@prisma/client';

/**
 * Result returned after changing one user's credit balance.
 *
 * @author Malak
 */
export type CreditBalanceResult = {
  readonly previousBalance: number;
  readonly balanceAfter: number;
  readonly previousAccountStatus: AccountStatus;
  readonly accountStatus: AccountStatus;
  readonly transaction: CreditTransaction;
};