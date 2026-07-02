import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ComplaintStatus,
  CreditTransactionType,
  IdeaGenerationType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DashboardResponseDto } from './dto/dashboard-response.dto';
import { toNumber } from '../../utilities/analytics/analytics.helper';

type UsersGrowthRow = {
  date: Date;
  count: number;
};

/**
 * Service responsible for providing Admin dashboard analytics.
 *
 * @author Malak
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves summarized analytics for the Admin dashboard.
   *
   * Notes:
   * - Admin accounts are excluded from platform-user statistics.
   * - Premium users are USER accounts with PREMIUM account status.
   * - AI success/error rates are returned as percentages.
   */
  async getDashboard(): Promise<DashboardResponseDto> {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    );

    const startOfLast30Days = new Date(now);
    startOfLast30Days.setDate(now.getDate() - 30);
    startOfLast30Days.setHours(0, 0, 0, 0);

    const [
      users,
      normalUsers,
      premiumUsers,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      unverifiedUsers,

      ideas,
      guestIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      unlockedIdeas,
      lockedIdeas,

      payments,
      successfulPaymentsCount,
      pendingPaymentsCount,
      failedPaymentsCount,
      refundedPaymentsCount,
      directUnlockPaymentsCount,
      creditPurchasePaymentsCount,

      comments,

      creditsSold,
      totalPremiumCreditBalance,
      creditPurchases,
      creditRefunds,
      manualCreditAdjustments,

      revenueTotal,
      refundsTotal,

      aiRequests,
      failedAiRequests,
      aiStats,

      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      rejectedComplaints,

      generatedOutputs,
      generatedOutputsByType,

      activeDomainsCount,
      inactiveDomainsCount,
      activePlatformsCount,
      inactivePlatformsCount,

      todayUsers,
      todayIdeas,
      todayPayments,
      todayRevenue,

      monthlyUsers,
      monthlyIdeas,
      monthlyPayments,
      monthlyRevenue,

      mostSelectedDomains,
      mostRequestedRegions,
      mostUsedPlatforms,
      usersGrowthRaw,
      usersByType,

      recentUsers,
      recentPaymentsRaw,
      recentIdeas,
      recentComplaints,
    ] = await Promise.all([
      this.prisma.user.count(),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          accountStatus: AccountStatus.NORMAL,
        },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          accountStatus: AccountStatus.PREMIUM,
        },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          isActive: true,
        },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          isActive: false,
        },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          isVerified: true,
        },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          isVerified: false,
        },
      }),

      this.prisma.idea.count(),

      this.prisma.idea.count({
        where: { generationType: IdeaGenerationType.GUEST_FREE },
      }),

      this.prisma.idea.count({
        where: { generationType: IdeaGenerationType.NORMAL_FREE },
      }),

      this.prisma.idea.count({
        where: { generationType: IdeaGenerationType.PREMIUM_CREDIT },
      }),

      this.prisma.idea.count({
        where: { isUnlocked: true },
      }),

      this.prisma.idea.count({
        where: { isUnlocked: false },
      }),

      this.prisma.payment.count(),

      this.prisma.payment.count({
        where: { status: PaymentStatus.SUCCESS },
      }),

      this.prisma.payment.count({
        where: { status: PaymentStatus.PENDING },
      }),

      this.prisma.payment.count({
        where: { status: PaymentStatus.FAILED },
      }),

      this.prisma.payment.count({
        where: { status: PaymentStatus.REFUNDED },
      }),

      this.prisma.payment.count({
        where: { paymentPurpose: PaymentPurpose.DIRECT_UNLOCK },
      }),

      this.prisma.payment.count({
        where: { paymentPurpose: PaymentPurpose.BUY_CREDITS },
      }),

      this.prisma.comment.count(),

      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { creditsAmount: true },
      }),

      this.prisma.user.aggregate({
        where: {
          role: UserRole.USER,
          accountStatus: AccountStatus.PREMIUM,
        },
        _sum: { creditBalance: true },
      }),

      this.prisma.creditTransaction.count({
        where: { type: CreditTransactionType.PURCHASE },
      }),

      this.prisma.creditTransaction.count({
        where: { type: CreditTransactionType.REFUND },
      }),

      this.prisma.creditTransaction.count({
        where: { type: CreditTransactionType.ADMIN_ADJUSTMENT },
      }),

      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amount: true },
      }),

      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.REFUNDED },
        _sum: { amount: true },
      }),

      this.prisma.externalApiLog.count(),

      this.prisma.externalApiLog.count({
        where: { isSuccess: false },
      }),

      this.prisma.externalApiLog.aggregate({
        _avg: { responseTimeMs: true },
        _sum: { costEstimate: true },
      }),

      this.prisma.complaint.count({
        where: { status: ComplaintStatus.OPEN },
      }),

      this.prisma.complaint.count({
        where: { status: ComplaintStatus.IN_PROGRESS },
      }),

      this.prisma.complaint.count({
        where: { status: ComplaintStatus.RESOLVED },
      }),

      this.prisma.complaint.count({
        where: { status: ComplaintStatus.REJECTED },
      }),

      this.prisma.generatedOutput.count(),

      this.prisma.generatedOutput.groupBy({
        by: ['outputType'],
        _count: { _all: true },
      }),

      this.prisma.domain.count({
        where: { isActive: true },
      }),

      this.prisma.domain.count({
        where: { isActive: false },
      }),

      this.prisma.platform.count({
        where: { isActive: true },
      }),

      this.prisma.platform.count({
        where: { isActive: false },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          createdAt: { gte: startOfToday },
        },
      }),

      this.prisma.idea.count({
        where: { createdAt: { gte: startOfToday } },
      }),

      this.prisma.payment.count({
        where: { createdAt: { gte: startOfToday } },
      }),

      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
          createdAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),

      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          createdAt: { gte: startOfMonth },
        },
      }),

      this.prisma.idea.count({
        where: { createdAt: { gte: startOfMonth } },
      }),

      this.prisma.payment.count({
        where: { createdAt: { gte: startOfMonth } },
      }),

      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),

      this.prisma.idea.groupBy({
        by: ['domainId'],
        _count: { domainId: true },
        orderBy: { _count: { domainId: 'desc' } },
        take: 5,
      }),

      this.prisma.idea.groupBy({
        by: ['selectedRegion'],
        where: { selectedRegion: { not: null } },
        _count: { selectedRegion: true },
        orderBy: { _count: { selectedRegion: 'desc' } },
        take: 5,
      }),

      this.prisma.idea.groupBy({
        by: ['selectedPlatformId'],
        where: { selectedPlatformId: { not: null } },
        _count: { selectedPlatformId: true },
        orderBy: { _count: { selectedPlatformId: 'desc' } },
        take: 5,
      }),

      this.prisma.$queryRaw<UsersGrowthRow[]>(Prisma.sql`
        SELECT
          DATE(created_at) AS date,
          COUNT(*)::int AS count
        FROM users
        WHERE created_at >= ${startOfLast30Days}
          AND role = 'USER'
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC
      `),

      this.prisma.user.groupBy({
        by: ['userType'],
        where: { role: UserRole.USER },
        _count: { _all: true },
      }),

      this.prisma.user.findMany({
        take: 5,
        where: { role: UserRole.USER },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          accountStatus: true,
          userType: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
        },
      }),

      this.prisma.payment.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          paymentMethod: true,
          paymentPurpose: true,
          status: true,
          creditsAmount: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),

      this.prisma.idea.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          generationType: true,
          isUnlocked: true,
          selectedRegion: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              userType: true,
            },
          },
          domain: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),

      this.prisma.complaint.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    const domainIds = mostSelectedDomains.map((item) => item.domainId);

    const platformIds = mostUsedPlatforms
      .map((item) => item.selectedPlatformId)
      .filter((id): id is string => Boolean(id));

    const [domains, platforms] = await Promise.all([
      this.prisma.domain.findMany({
        where: { id: { in: domainIds } },
        select: { id: true, name: true },
      }),

      this.prisma.platform.findMany({
        where: { id: { in: platformIds } },
        select: { id: true, name: true },
      }),
    ]);

    const domainMap = new Map(
      domains.map((domain) => [domain.id, domain.name]),
    );

    const platformMap = new Map(
      platforms.map((platform) => [platform.id, platform.name]),
    );

    const usersGrowthChart = usersGrowthRaw.map((item) => ({
      date: item.date.toISOString().split('T')[0],
      count: item.count,
    }));

    const aiErrorRate =
      aiRequests === 0
        ? 0
        : Number(((failedAiRequests / aiRequests) * 100).toFixed(2));

    const aiSuccessRate =
      aiRequests === 0
        ? 0
        : Number(
            (
              ((aiRequests - failedAiRequests) / aiRequests) *
              100
            ).toFixed(2),
          );

    const averageAiCostPerRequest =
      aiRequests === 0
        ? 0
        : Number((toNumber(aiStats._sum.costEstimate) / aiRequests).toFixed(4));

    const averageCreditsPerPremiumUser =
      premiumUsers === 0
        ? 0
        : Number(
            (
              (totalPremiumCreditBalance._sum.creditBalance ?? 0) /
              premiumUsers
            ).toFixed(2),
          );

    const recentPayments = recentPaymentsRaw.map((payment) => ({
      ...payment,
      amount: toNumber(payment.amount),
    }));

    return {
      users,
      normalUsers,
      premiumUsers,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      unverifiedUsers,

      ideas,
      guestIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      unlockedIdeas,
      lockedIdeas,

      payments,
      successfulPaymentsCount,
      pendingPaymentsCount,
      failedPaymentsCount,
      refundedPaymentsCount,
      directUnlockPaymentsCount,
      creditPurchasePaymentsCount,

      comments,

      creditsSold: creditsSold._sum.creditsAmount ?? 0,
      creditPurchases,
      creditRefunds,
      manualCreditAdjustments,
      averageCreditsPerPremiumUser,

      revenueTotal: toNumber(revenueTotal._sum.amount),
      refundsTotal: toNumber(refundsTotal._sum.amount),

      aiRequests,
      failedAiRequests,
      aiSuccessRate,
      aiErrorRate,
      averageResponseTime: toNumber(aiStats._avg.responseTimeMs),
      aiCost: toNumber(aiStats._sum.costEstimate),
      averageAiCostPerRequest,

      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      rejectedComplaints,

      generatedOutputs,
      generatedOutputsByType: generatedOutputsByType.map((item) => ({
        label: item.outputType,
        outputType: item.outputType,
        count: item._count._all,
      })),

      domainsStatus: {
        active: activeDomainsCount,
        inactive: inactiveDomainsCount,
      },

      platformsStatus: {
        active: activePlatformsCount,
        inactive: inactivePlatformsCount,
      },

      todayStats: {
        users: todayUsers,
        ideas: todayIdeas,
        payments: todayPayments,
        revenue: toNumber(todayRevenue._sum.amount),
      },

      monthlyStats: {
        users: monthlyUsers,
        ideas: monthlyIdeas,
        payments: monthlyPayments,
        revenue: toNumber(monthlyRevenue._sum.amount),
      },

      usersGrowthChart,

      usersByType: usersByType.map((item) => ({
        label: item.userType ?? 'UNKNOWN',
        userType: item.userType,
        count: item._count._all,
      })),

      mostSelectedDomains: mostSelectedDomains.map((item) => {
        const domainName = domainMap.get(item.domainId) ?? null;

        return {
          label: domainName ?? 'Unknown Domain',
          domainId: item.domainId,
          domainName,
          count: item._count.domainId,
        };
      }),

      mostRequestedRegions: mostRequestedRegions.map((item) => ({
        label: item.selectedRegion ?? 'Unknown Region',
        region: item.selectedRegion,
        count: item._count.selectedRegion,
      })),

      mostUsedPlatforms: mostUsedPlatforms.map((item) => {
        const platformName =
          item.selectedPlatformId !== null
            ? platformMap.get(item.selectedPlatformId) ?? null
            : null;

        return {
          label: platformName ?? 'Unknown Platform',
          platformId: item.selectedPlatformId,
          platformName,
          count: item._count.selectedPlatformId,
        };
      }),

      recentActivity: {
        recentUsers,
        recentPayments,
        recentIdeas,
        recentComplaints,
      },
    };
  }
}