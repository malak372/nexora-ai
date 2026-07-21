import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApiRequestType,
  ComplaintStatus,
  CreditTransactionType,
  IdeaGenerationType,
  PaymentPurpose,
  PaymentStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

/**
 * Produces system-wide administrative analytics using the current Prisma
 * schema. Platform analytics are derived from CollectionJobSource/DataSource.
 *
 * @author Malak
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the full administrative dashboard. */
  async getDashboard(): Promise<DashboardResponseDto> {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      users,
      normalUsers,
      premiumUsers,
      activeUsers,
      verifiedUsers,
      ideas,
      guestIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      unlockedIdeas,
      payments,
      succeededPayments,
      pendingPayments,
      failedPayments,
      refundedPayments,
      directUnlockPayments,
      creditPurchasePayments,
      comments,
      creditsSold,
      revenue,
      refunds,
      aiRequests,
      failedAiRequests,
      aiResponseTime,
      aiCost,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      rejectedComplaints,
      generatedOutputs,
      generatedOutputsByKey,
      activeDomains,
      inactiveDomains,
      activeDataSources,
      inactiveDataSources,
      todayUsers,
      todayIdeas,
      todayPayments,
      todayRevenue,
      monthlyUsers,
      monthlyIdeas,
      monthlyPayments,
      monthlyRevenue,
      usersByTypeRaw,
      domainsRaw,
      regionsRaw,
      sourceUsageRaw,
      recentUsers,
      recentPayments,
      recentIdeas,
      recentComplaints,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { deletedAt: null, accountStatus: AccountStatus.NORMAL },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, accountStatus: AccountStatus.PREMIUM },
      }),
      this.prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.user.count({ where: { deletedAt: null, isVerified: true } }),
      this.prisma.idea.count({ where: { deletedAt: null } }),
      this.prisma.idea.count({
        where: {
          deletedAt: null,
          generationType: IdeaGenerationType.GUEST_FREE,
        },
      }),
      this.prisma.idea.count({
        where: {
          deletedAt: null,
          generationType: IdeaGenerationType.NORMAL_FREE,
        },
      }),
      this.prisma.idea.count({
        where: {
          deletedAt: null,
          generationType: IdeaGenerationType.PREMIUM_CREDIT,
        },
      }),
      this.prisma.idea.count({ where: { deletedAt: null, isUnlocked: true } }),
      this.prisma.payment.count(),
      this.prisma.payment.count({ where: { status: PaymentStatus.SUCCEEDED } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.FAILED } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.REFUNDED } }),
      this.prisma.payment.count({
        where: { paymentPurpose: PaymentPurpose.DIRECT_UNLOCK },
      }),
      this.prisma.payment.count({
        where: { paymentPurpose: PaymentPurpose.BUY_CREDITS },
      }),
      this.prisma.socialComment.count(),
      this.prisma.creditTransaction.aggregate({
        where: {
          type: {
            in: [CreditTransactionType.PURCHASE, CreditTransactionType.BONUS],
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCEEDED },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.REFUNDED },
        _sum: { amount: true },
      }),
      this.prisma.externalApiLog.count({
        where: {
          requestType: {
            in: [
              ApiRequestType.IDEA_GENERATION,
              ApiRequestType.NLP_ENHANCEMENT,
              ApiRequestType.AI_CHAT,
            ],
          },
        },
      }),
      this.prisma.externalApiLog.count({
        where: {
          requestType: {
            in: [
              ApiRequestType.IDEA_GENERATION,
              ApiRequestType.NLP_ENHANCEMENT,
              ApiRequestType.AI_CHAT,
            ],
          },
          isSuccess: false,
        },
      }),
      this.prisma.externalApiLog.aggregate({
        where: { responseTimeMs: { not: null } },
        _avg: { responseTimeMs: true },
      }),
      this.prisma.externalApiLog.aggregate({
        _sum: { costEstimate: true },
      }),
      this.prisma.complaint.count({
        where: { deletedAt: null, status: ComplaintStatus.OPEN },
      }),
      this.prisma.complaint.count({
        where: { deletedAt: null, status: ComplaintStatus.IN_PROGRESS },
      }),
      this.prisma.complaint.count({
        where: { deletedAt: null, status: ComplaintStatus.RESOLVED },
      }),
      this.prisma.complaint.count({
        where: { deletedAt: null, status: ComplaintStatus.REJECTED },
      }),
      this.prisma.generatedOutput.count(),
      this.prisma.generatedOutput.groupBy({
        by: ['outputKey'],
        _count: { _all: true },
        orderBy: { _count: { outputKey: 'desc' } },
      }),
      this.prisma.domain.count({ where: { isActive: true } }),
      this.prisma.domain.count({ where: { isActive: false } }),
      this.prisma.dataSource.count({ where: { isActive: true } }),
      this.prisma.dataSource.count({ where: { isActive: false } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.idea.count({
        where: { deletedAt: null, createdAt: { gte: startOfToday } },
      }),
      this.prisma.payment.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCEEDED,
          createdAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.idea.count({
        where: { deletedAt: null, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.payment.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCEEDED,
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.user.groupBy({
        by: ['userType'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.idea.groupBy({
        by: ['domainId'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { _count: { domainId: 'desc' } },
        take: 10,
      }),
      this.prisma.idea.groupBy({
        by: ['selectedRegion'],
        where: { deletedAt: null, selectedRegion: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { selectedRegion: 'desc' } },
        take: 10,
      }),
      this.prisma.collectionJobSource.groupBy({
        by: ['dataSourceId'],
        _sum: { totalPosts: true, totalComments: true },
        orderBy: { _sum: { totalPosts: 'desc' } },
        take: 10,
      }),
      this.prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
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
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          amount: true,
          currency: true,
          paymentMethodKey: true,
          providerKey: true,
          paymentPurpose: true,
          status: true,
          creditsAmount: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.idea.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          generationType: true,
          isUnlocked: true,
          selectedRegion: true,
          createdAt: true,
          user: {
            select: { id: true, fullName: true, email: true, userType: true },
          },
          domain: { select: { id: true, name: true } },
        },
      }),
      this.prisma.complaint.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
    ]);

    const domainIds = domainsRaw.map((item) => item.domainId);
    const sourceIds = sourceUsageRaw.map((item) => item.dataSourceId);
    const [domains, dataSources] = await Promise.all([
      this.prisma.domain.findMany({
        where: { id: { in: domainIds } },
        select: { id: true, name: true },
      }),
      this.prisma.dataSource.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, key: true, displayName: true },
      }),
    ]);
    const domainMap = new Map(
      domains.map((domain) => [domain.id, domain.name]),
    );
    const sourceMap = new Map(dataSources.map((source) => [source.id, source]));

    const aiCostNumber = Number(aiCost._sum.costEstimate ?? 0);
    const revenueTotal = Number(revenue._sum.amount ?? 0);
    const refundsTotal = Number(refunds._sum.amount ?? 0);
    const aiSuccessRate =
      aiRequests === 0
        ? 0
        : ((aiRequests - failedAiRequests) / aiRequests) * 100;

    return {
      users,
      normalUsers,
      premiumUsers,
      activeUsers,
      inactiveUsers: users - activeUsers,
      verifiedUsers,
      unverifiedUsers: users - verifiedUsers,
      ideas,
      guestIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      unlockedIdeas,
      lockedIdeas: ideas - unlockedIdeas,
      payments,
      successfulPaymentsCount: succeededPayments,
      pendingPaymentsCount: pendingPayments,
      failedPaymentsCount: failedPayments,
      refundedPaymentsCount: refundedPayments,
      directUnlockPaymentsCount: directUnlockPayments,
      creditPurchasePaymentsCount: creditPurchasePayments,
      comments,
      creditsSold: creditsSold._sum.amount ?? 0,
      revenueTotal,
      refundsTotal,
      aiRequests,
      failedAiRequests,
      aiSuccessRate,
      aiErrorRate: aiRequests === 0 ? 0 : 100 - aiSuccessRate,
      averageResponseTime: aiResponseTime._avg.responseTimeMs ?? 0,
      aiCost: aiCostNumber,
      averageAiCostPerRequest: aiRequests === 0 ? 0 : aiCostNumber / aiRequests,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      rejectedComplaints,
      generatedOutputs,
      generatedOutputsByKey: generatedOutputsByKey.map((item) => ({
        label: item.outputKey,
        outputKey: item.outputKey,
        count: item._count._all,
      })),
      domainsStatus: { active: activeDomains, inactive: inactiveDomains },
      dataSourcesStatus: {
        active: activeDataSources,
        inactive: inactiveDataSources,
      },
      todayStats: {
        users: todayUsers,
        ideas: todayIdeas,
        payments: todayPayments,
        revenue: Number(todayRevenue._sum.amount ?? 0),
      },
      monthlyStats: {
        users: monthlyUsers,
        ideas: monthlyIdeas,
        payments: monthlyPayments,
        revenue: Number(monthlyRevenue._sum.amount ?? 0),
      },
      usersGrowthChart: [],
      usersByType: usersByTypeRaw.map((item) => ({
        label: item.userType,
        userType: item.userType,
        count: item._count._all,
      })),
      mostSelectedDomains: domainsRaw.map((item) => ({
        label: domainMap.get(item.domainId) ?? 'Unknown domain',
        domainId: item.domainId,
        domainName: domainMap.get(item.domainId) ?? null,
        count: item._count._all,
      })),
      mostRequestedRegions: regionsRaw.map((item) => ({
        label: item.selectedRegion ?? 'Unknown',
        region: item.selectedRegion,
        count: item._count._all,
      })),
      mostUsedDataSources: sourceUsageRaw.map((item) => {
        const source = sourceMap.get(item.dataSourceId);
        return {
          label: source?.displayName ?? 'Unknown source',
          dataSourceId: item.dataSourceId,
          dataSourceKey: source?.key ?? null,
          count: (item._sum.totalPosts ?? 0) + (item._sum.totalComments ?? 0),
        };
      }),
      recentActivity: {
        recentUsers,
        recentPayments: recentPayments.map((payment) => ({
          ...payment,
          amount: Number(payment.amount),
        })),
        recentIdeas,
        recentComplaints,
      },
    };
  }
}
