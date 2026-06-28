import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for providing Admin dashboard analytics.
 *
 * This service collects high-level platform metrics, recent activity,
 * financial summaries, AI usage statistics, and chart-ready data
 * for the Admin dashboard.
 *
 * @author Malak
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Retrieves summarized dashboard analytics for the Admin panel.
   *
   * @returns Dashboard statistics, analytics summary, recent activity,
   * and chart-ready data.
   */
  async getDashboard() {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
        where: {
          status: PaymentStatus.SUCCESS,
        },
        _sum: {
          creditsAmount: true,
        },
      }),

      this.prisma.externalApiLog.count(),

      this.prisma.externalApiLog.aggregate({
        _avg: {
          responseTimeMs: true,
        },
        _sum: {
          costEstimate: true,
        },
      }),

      this.prisma.externalApiLog.count({
        where: {
          isSuccess: false,
        },
      }),

      this.prisma.payment.count({
        where: {
          status: PaymentStatus.FAILED,
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
        },
        _sum: {
          amount: true,
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.REFUNDED,
        },
        _sum: {
          amount: true,
        },
      }),

      this.prisma.domain.count({
        where: {
          isActive: true,
        },
      }),

      this.prisma.domain.count({
        where: {
          isActive: false,
        },
      }),

      this.prisma.platform.count({
        where: {
          isActive: true,
        },
      }),

      this.prisma.platform.count({
        where: {
          isActive: false,
        },
      }),

      this.prisma.user.count({
        where: {
          createdAt: {
            gte: startOfToday,
          },
        },
      }),

      this.prisma.idea.count({
        where: {
          createdAt: {
            gte: startOfToday,
          },
        },
      }),

      this.prisma.payment.count({
        where: {
          createdAt: {
            gte: startOfToday,
          },
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
          createdAt: {
            gte: startOfToday,
          },
        },
        _sum: {
          amount: true,
        },
      }),

      this.prisma.user.count({
        where: {
          createdAt: {
            gte: startOfMonth,
          },
        },
      }),

      this.prisma.idea.count({
        where: {
          createdAt: {
            gte: startOfMonth,
          },
        },
      }),

      this.prisma.payment.count({
        where: {
          createdAt: {
            gte: startOfMonth,
          },
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESS,
          createdAt: {
            gte: startOfMonth,
          },
        },
        _sum: {
          amount: true,
        },
      }),

      this.prisma.idea.groupBy({
        by: ['domainId'],
        _count: {
          domainId: true,
        },
        orderBy: {
          _count: {
            domainId: 'desc',
          },
        },
        take: 5,
      }),

      this.prisma.idea.groupBy({
        by: ['selectedRegion'],
        where: {
          selectedRegion: {
            not: null,
          },
        },
        _count: {
          selectedRegion: true,
        },
        orderBy: {
          _count: {
            selectedRegion: 'desc',
          },
        },
        take: 5,
      }),

      this.prisma.idea.groupBy({
        by: ['selectedPlatformId'],
        where: {
          selectedPlatformId: {
            not: null,
          },
        },
        _count: {
          selectedPlatformId: true,
        },
        orderBy: {
          _count: {
            selectedPlatformId: 'desc',
          },
        },
        take: 5,
      }),

      this.prisma.user.groupBy({
        by: ['createdAt'],
        _count: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),

      this.prisma.user.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
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
        orderBy: {
          createdAt: 'desc',
        },
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
        orderBy: {
          createdAt: 'desc',
        },
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
        orderBy: {
          createdAt: 'desc',
        },
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
      .filter((id): id is string => id !== null);

    const [domains, platforms] = await Promise.all([
      this.prisma.domain.findMany({
        where: {
          id: {
            in: domainIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      }),

      this.prisma.platform.findMany({
        where: {
          id: {
            in: platformIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    const usersGrowthChart = usersGrowthRaw.map((item) => ({
      date: item.createdAt.toISOString().split('T')[0],
      count: item._count.id,
    }));

    const aiErrorRate =
      aiRequests > 0 ? (failedAiRequests / aiRequests) * 100 : 0;

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
        domainName:
          domains.find((domain) => domain.id === item.domainId)?.name ?? null,
        count: item._count.domainId,
      })),

      mostRequestedRegions: mostRequestedRegions.map((item) => ({
        region: item.selectedRegion,
        count: item._count.selectedRegion,
      })),

      mostUsedPlatforms: mostUsedPlatforms.map((item) => ({
        platformId: item.selectedPlatformId,
        platformName:
          platforms.find(
            (platform) => platform.id === item.selectedPlatformId,
          )?.name ?? null,
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