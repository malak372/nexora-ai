import { Injectable } from '@nestjs/common';

import { IdeaGenerationType, Prisma } from '@prisma/client';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

/**
 * Payment data required to validate a direct idea unlock.
 */
type DirectUnlockPayment = {
  readonly id: string;
  readonly userId: string;
  readonly ideaId: string | null;
};

/**
 * Result returned after validating a direct-unlock payment.
 *
 * This service intentionally does not mark the idea as unlocked. Advanced
 * outputs must be generated and persisted first by IdeaUnlockService.
 */
export type DirectUnlockValidationResult = {
  readonly ideaId: string;
};

/**
 * Validates successful direct-unlock payments inside the payment transaction.
 *
 * Responsibilities:
 * - Ensure the payment references an idea.
 * - Ensure the idea exists and belongs to the payment owner.
 * - Allow direct payment only for NORMAL_FREE ideas.
 * - Reject ideas that were already unlocked before checkout fulfillment.
 *
 * AI execution is deliberately excluded from this service because external
 * API calls must not run inside a database transaction.
 *
 * @author Eman
 */
@Injectable()
export class DirectUnlockPaymentService {
  async validateForFulfillment(
    payment: DirectUnlockPayment,
    tx: Prisma.TransactionClient,
  ): Promise<DirectUnlockValidationResult> {
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
        deletedAt: true,
        generationType: true,
        isUnlocked: true,
        unlockMethod: true,
        collectionJobId: true,
      },
    });

    if (!idea || idea.deletedAt) {
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
        'Only a registered-user free idea can be unlocked through direct payment.',
        {
          details: {
            paymentId: payment.id,
            ideaId: idea.id,
            generationType: idea.generationType,
          },
        },
      );
    }

    if (!idea.collectionJobId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.DIRECT_UNLOCK_PROCESSING_FAILED,
        'The selected idea does not contain the collection context required for advanced-output generation.',
        {
          details: {
            paymentId: payment.id,
            ideaId: idea.id,
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

    return {
      ideaId: idea.id,
    };
  }
}