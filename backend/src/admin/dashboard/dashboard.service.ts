import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

/**
 * Represents one row returned from the raw SQL query
 * used to build the users growth chart.
 *
 * The raw query groups users by creation date.
 */
type UsersGrowthRow = {
  /** User creation date grouped by day. */
  date: Date;

  /** Number of users created on that date. */
  count: number;
};

/**
 * Service responsible for providing Admin dashboard analytics.
 *
 * This service collects high-level platform metrics, recent activity,
 * financial summaries, AI usage statistics, domain/platform statistics,
 * and chart-ready data for the Admin dashboard.
 *
 * @author Malak
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves summarized analytics for the Admin dashboard.
   *
   * The returned dashboard data includes:
   * - Total users, ideas, payments, and comments.
   * - Total credits sold.
   * - Total revenue, refunds, and failed payments.
   * - AI API request statistics.
   * - AI error rate, average response time, and estimated OpenAI cost.
   * - Active and inactive domains.
   * - Active and inactive platforms.
   * - Today statistics.
   * - Monthly statistics.
   * - Most selected domains.
   * - Most requested regions.
   * - Most used platforms.
   * - User growth chart for the last 30 days.
   * - Recent users, payments, ideas, and complaints.
   *
   * @returns Admin dashboard response data.
   */
  async getDashboard(): Promise<DashboardResponseDto> {
    const now = new Date();

    /**
     * Start of the current day.
     *
     * Used to calculate today's users, ideas, payments,
     * and successful payment revenue.
     */
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    /**
     * Start of the current month.
     *
     * Used to calculate monthly users, ideas, payments,
     * and successful payment revenue.
     */
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    /**
     * Start date for the user growth chart.
     *
     * The chart only displays the last 30 days to keep
     * the dashboard lightweight and focused.
     */
    const startOfLast30Days = new Date(now);
    startOfLast30Days.setDate(now.getDate() - 30);
    startOfLast30Days.setHours(0, 0, 0, 0);

    /**
     * Executes independent dashboard queries in parallel
     * to improve dashboard response time.
     */
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
      recentPayments,
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

      /**
       * Raw PostgreSQL query used for accurate daily grouping.
       *
       * Prisma groupBy on createdAt groups by the full timestamp,
       * while the dashboard needs grouping by day only.
       */
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

    /**
     * Extracts the domain IDs from the top selected domains
     * in order to fetch their readable names.
     */
    const domainIds = mostSelectedDomains.map((item) => item.domainId);

    /**
     * Extracts non-null platform IDs from the top used platforms
     * in order to fetch their readable names.
     */
    const platformIds = mostUsedPlatforms
      .map((item) => item.selectedPlatformId)
      .filter((id): id is string => id !== null);

    /**
     * Fetches domain and platform names in parallel.
     */
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

    /**
     * Maps domain IDs to domain names for fast lookup.
     */
    const domainMap = new Map(
      domains.map((domain) => [domain.id, domain.name]),
    );

    /**
     * Maps platform IDs to platform names for fast lookup.
     */
    const platformMap = new Map(
      platforms.map((platform) => [platform.id, platform.name]),
    );

    /**
     * Formats raw user growth rows into chart-ready data.
     */
    const usersGrowthChart = usersGrowthRaw.map((item) => ({
      date: item.date.toISOString().split('T')[0],
      count: item.count,
    }));

    /**
     * Calculates the AI API error rate as a percentage.
     *
     * If there are no AI requests, the error rate is returned as 0
     * to avoid division by zero.
     */
    const aiErrorRate =
      aiRequests > 0
        ? Number(((failedAiRequests / aiRequests) * 100).toFixed(2))
        : 0;

    return {
      users,
      ideas,
      payments,
      comments,

      creditsSold: creditsSold._sum.creditsAmount ?? 0,

      revenueTotal: revenueTotal._sum.amount ?? 0,
      refundsTotal: refundsTotal._sum.amount ?? 0,
      failedPaymentsCount,

      aiRequests,
      failedAiRequests,
      aiErrorRate,
      averageResponseTime: aiStats._avg.responseTimeMs ?? 0,
      openAiCost: aiStats._sum.costEstimate ?? 0,

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
        revenue: todayRevenue._sum.amount ?? 0,
      },

      monthlyStats: {
        users: monthlyUsers,
        ideas: monthlyIdeas,
        payments: monthlyPayments,
        revenue: monthlyRevenue._sum.amount ?? 0,
      },

      usersGrowthChart,

      mostSelectedDomains: mostSelectedDomains.map((item) => ({
        domainId: item.domainId,
        domainName: domainMap.get(item.domainId) ?? null,
        count: item._count.domainId,
      })),

      mostRequestedRegions: mostRequestedRegions.map((item) => ({
        region: item.selectedRegion,
        count: item._count.selectedRegion,
      })),

      mostUsedPlatforms: mostUsedPlatforms.map((item) => ({
        platformId: item.selectedPlatformId,
        platformName:
          item.selectedPlatformId !== null
            ? platformMap.get(item.selectedPlatformId) ?? null
            : null,
        count: item._count.selectedPlatformId,
      })),

      recentActivity: {
        recentUsers,
        recentPayments,
        recentIdeas,
        recentComplaints,
      },
    };
  }
}