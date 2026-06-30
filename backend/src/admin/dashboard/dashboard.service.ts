import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

import {
  calculateSuccessRate,
  toNumber,
} from '../../utilities/analytics/analytics.helper';

/**
 * Represents one row returned from the raw SQL query
 * used to build the users growth chart.
 */
type UsersGrowthRow = {
  date: Date;
  count: number;
};

/**
 * Service responsible for providing Admin dashboard analytics.
 *
 * Collects high-level platform metrics, financial summaries,
 * AI usage statistics, domain/platform statistics, chart-ready data,
 * and recent activity for the Admin dashboard.
 *
 * @author Malak
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves summarized analytics for the Admin dashboard.
   *
   * Endpoint:
   * GET /admin/dashboard
   *
   * @returns Admin dashboard response data.
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
      ideas,
      payments,
      comments,
      creditsSold,
      aiRequests,
      aiStats,
      failedAiRequests,
      failedPaymentsCount,
      revenueTotal,
      refundsTotal,
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
      recentUsers,
      recentPaymentsRaw,
      recentIdeas,
      recentComplaints,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.idea.count(),
      this.prisma.payment.count(),
      this.prisma.comment.count(),

      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { creditsAmount: true },
      }),

      this.prisma.externalApiLog.count(),

      this.prisma.externalApiLog.aggregate({
        _avg: { responseTimeMs: true },
        _sum: { costEstimate: true },
      }),

      this.prisma.externalApiLog.count({
        where: { isSuccess: false },
      }),

      this.prisma.payment.count({
        where: { status: PaymentStatus.FAILED },
      }),

      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amount: true },
      }),

      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.REFUNDED },
        _sum: { amount: true },
      }),

      this.prisma.domain.count({ where: { isActive: true } }),
      this.prisma.domain.count({ where: { isActive: false } }),

      this.prisma.platform.count({ where: { isActive: true } }),
      this.prisma.platform.count({ where: { isActive: false } }),

      this.prisma.user.count({
        where: { createdAt: { gte: startOfToday } },
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
        where: { createdAt: { gte: startOfMonth } },
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
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC
      `),

      this.prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          accountStatus: true,
          isActive: true,
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

    const aiErrorRate = calculateSuccessRate(
      failedAiRequests,
      aiRequests,
    );

    const recentPayments = recentPaymentsRaw.map((payment) => ({
      ...payment,
      amount: toNumber(payment.amount),
    }));

    return {
      users,
      ideas,
      payments,
      comments,

      creditsSold: creditsSold._sum.creditsAmount ?? 0,

      revenueTotal: toNumber(revenueTotal._sum.amount),
      refundsTotal: toNumber(refundsTotal._sum.amount),
      failedPaymentsCount,

      aiRequests,
      failedAiRequests,
      aiErrorRate,
      averageResponseTime: toNumber(aiStats._avg.responseTimeMs),
      aiCost: toNumber(aiStats._sum.costEstimate),

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