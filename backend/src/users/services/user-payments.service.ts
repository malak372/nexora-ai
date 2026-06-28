import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserCommonService } from './user-common.service';

/**
 * Service responsible for user payment operations.
 *
 * This service handles retrieving payment history
 * for the authenticated user.
 *
 * It uses UserCommonService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserCommonService,
  ) { }

  /**
   * Retrieves the authenticated user's payment history.
   *
   * Returns all payment records associated with the authenticated user,
   * ordered from newest to oldest.
   *
   * @param userId - Authenticated user ID.
   * @returns User payment history.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getPaymentHistory(userId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        status: true,
        paymentPurpose: true,
        creditsAmount: true,
        transactionReference: true,
        ideaId: true,
        createdAt: true,
      },
    });
  }
}