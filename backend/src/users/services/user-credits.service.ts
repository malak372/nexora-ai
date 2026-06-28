import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserCommonService } from './user-common.service';

/**
 * Service responsible for user credit operations.
 *
 * This service handles the authenticated user's credit
 * balance and credit transaction history.
 *
 * It uses UserCommonService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserCommonService,
  ) { }

  /**
   * Retrieves the authenticated user's credit information.
   *
   * Returns the current credit balance,
   * account status, and premium status.
   *
   * @param userId - Authenticated user ID.
   * @returns User credit information.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getCredits(userId: string) {
    const user = await this.userCommonService.findUserOrThrow(userId);

    return {
      creditBalance: user.creditBalance,
      accountStatus: user.accountStatus,
      isPremium: user.creditBalance > 0,
    };
  }

  /**
   * Retrieves the authenticated user's credit transaction history.
   *
   * Returns all credit transactions ordered
   * from newest to oldest.
   *
   * @param userId - Authenticated user ID.
   * @returns Credit transaction history.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getCreditHistory(userId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    return this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        createdAt: true,
        ideaId: true,
        paymentId: true,
      },
    });
  }
}