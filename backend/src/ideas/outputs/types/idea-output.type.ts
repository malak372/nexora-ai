import type { Prisma } from '@prisma/client';

import type { ParsedIdeaUnlockAiOutput } from '../../generation/types/idea-ai-output.type';

/**
 * Database client accepted by transaction-aware output persistence methods.
 *
 * @author Malak
 */
export type IdeaOutputDatabaseClient = Prisma.TransactionClient;

/**
 * Input required to persist parsed direct-unlock outputs.
 *
 * @author Malak
 */
export type PersistIdeaUnlockOutputInput = {
  readonly ideaId: string;
  readonly userId: string;
  readonly output: ParsedIdeaUnlockAiOutput;
};

/**
 * Result returned after acquiring a durable direct-unlock claim.
 *
 * @author Malak
 */
export type BeginIdeaUnlockResult = {
  readonly ideaId: string;
  readonly alreadyUnlocked: boolean;
  readonly unlockedAt?: Date;
};

/**
 * Result returned after successfully persisting an unlocked idea.
 *
 * @author Malak
 */
export type PersistedIdeaUnlockResult = {
  readonly ideaId: string;
  readonly unlockedAt: Date;
};

/**
 * Public API representation of one completed generated output.
 *
 * @author Malak
 */
export type IdeaOutputResponse = {
  id: string;
  outputKey: string;
  title: string;
  sequence: number;
  content: string | null;
  structuredContent: Prisma.JsonValue | null;
  generatedAt: Date | null;
};

/**
 * Input received from successful direct-payment fulfillment.
 *
 * @author Malak
 */
export type UnlockPaidIdeaInput = {
  readonly ideaId: string;
  readonly userId: string;
  readonly paymentId: string;
};

/**
 * Direct-unlock workflow result.
 *
 * @author Malak
 */
export type UnlockPaidIdeaResult = {
  readonly paymentId: string;
  readonly ideaId: string;
  readonly alreadyUnlocked: boolean;
  readonly completedNow: boolean;
  readonly unlockedAt: Date;
};