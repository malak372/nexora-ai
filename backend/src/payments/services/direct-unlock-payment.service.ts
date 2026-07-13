import { Injectable } from '@nestjs/common';

import { IdeaGenerationType, Prisma, UnlockMethod } from '@prisma/client';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

/**
 * Payment data required to fulfill a direct idea unlock.
 */
type DirectUnlockPayment = {
  readonly id: string;
  readonly userId: string;
  readonly ideaId: string | null;
};

/**
 * Result returned after unlocking an idea.
 */
export type DirectUnlockFulfillmentResult = {
  readonly ideaId: string;
  readonly isUnlocked: true;
  readonly unlockMethod: UnlockMethod;
  readonly unlockedAt: Date;
};

/**
 * Fulfills successful direct-unlock payments.
 *
 * Responsibilities:
 * - Validate that the payment references an idea.
 * - Validate idea existence and ownership.
 * - Allow direct payment only for NORMAL_FREE ideas.
 * - Prevent unlocking an already unlocked idea.
 * - Mark the idea as unlocked atomically.
 *
 * Direct-unlock payments:
 * - Do not add credits.
 * - Do not deduct credits.
 * - Do not create a new idea.
 *
 * Advanced-output generation remains owned by the
 * idea-generation or advanced-output workflow.
 *
 * @author Eman
 */
@Injectable()
export class DirectUnlockPaymentService {
  /**
   * Unlocks one eligible free idea.
   */
  async fulfill(
    payment: DirectUnlockPayment,
    tx: Prisma.TransactionClient,
  ): Promise<DirectUnlockFulfillmentResult> {
    if (!payment.ideaId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_FOUND,
        'A direct-unlock payment must reference an idea.',
        {
          details: {
            paymentId: payment.id,
          },
        },
      );
    }

    const idea = await tx.idea.findUnique({
      where: {
        id: payment.ideaId,
      },

      select: {
        id: true,
        userId: true,
        generationType: true,
        isUnlocked: true,
        unlockMethod: true,
      },
    });

    if (!idea) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_FOUND,
        'The idea associated with the direct-unlock payment does not exist.',
        {
          details: {
            paymentId: payment.id,
            ideaId: payment.ideaId,
          },
        },
      );
    }

    if (idea.userId !== payment.userId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ACCESS_DENIED,
        'The authenticated user does not own the selected idea.',
        {
          details: {
            paymentId: payment.id,
            ideaId: idea.id,
            userId: payment.userId,
          },
        },
      );
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_ELIGIBLE_FOR_DIRECT_UNLOCK,
        'Only a registered user free idea can be unlocked through direct payment.',
        {
          details: {
            paymentId: payment.id,
            ideaId: idea.id,
            generationType: idea.generationType,
          },
        },
      );
    }

    if (idea.isUnlocked) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ALREADY_UNLOCKED,
        'The selected idea has already been unlocked.',
        {
          details: {
            paymentId: payment.id,
            ideaId: idea.id,
            unlockMethod: idea.unlockMethod,
          },
        },
      );
    }

    const unlockedAt = new Date();

    const updateResult = await tx.idea.updateMany({
      where: {
        id: idea.id,
        userId: payment.userId,

        generationType: IdeaGenerationType.NORMAL_FREE,

        isUnlocked: false,
      },

      data: {
        isUnlocked: true,

        unlockMethod: UnlockMethod.DIRECT_PAYMENT,

        unlockedAt,
      },
    });

    if (updateResult.count !== 1) {
      throw new PaymentProcessingError(
        PaymentErrorCode.DIRECT_UNLOCK_PROCESSING_FAILED,
        'The selected idea could not be unlocked consistently.',
        {
          details: {
            paymentId: payment.id,
            ideaId: idea.id,
          },
        },
      );
    }

    return {
      ideaId: idea.id,
      isUnlocked: true,
      unlockMethod: UnlockMethod.DIRECT_PAYMENT,
      unlockedAt,
    };
  }
}
