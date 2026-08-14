import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AccountStatus,
  ApiRequestType,
  ComplaintStatus,
  CreditTransactionType,
  IdeaGenerationType,
  PaymentPurpose,
  PaymentStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

const DASHBOARD_CACHE_TTL_MS = 300_000;
const CHART_DAYS = 12;

const AI_REQUEST_TYPES: ApiRequestType[] = [
  ApiRequestType.IDEA_GENERATION,
  ApiRequestType.NLP_ENHANCEMENT,
  ApiRequestType.AI_CHAT,
];

@Injectable()
export class DashboardService implements OnModuleInit {
  private readonly cache = new Map<
    string,
    { value: DashboardResponseDto; expiresAt: number }
  >();

  private readonly inFlight = new Map<string, Promise<DashboardResponseDto>>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.getDashboard('all')
      .then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 1200);
          }),
      )
      .then(() => this.getDashboard('week'))
      .catch(() => undefined);
  }

  async getDashboard(periodInput?: string): Promise<DashboardResponseDto> {
    const period = this.normalizePeriod(periodInput);
    const now = Date.now();
    const cached = this.cache.get(period);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const current = this.inFlight.get(period);

    if (current) {
      return current;
    }

    const request = this.buildDashboard(period);
    this.inFlight.set(period, request);

    try {
      const value = await request;
      this.cache.set(period, {
        value,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      });
      return value;
    } finally {
      this.inFlight.delete(period);
    }
  }

  private async buildDashboard(period: string): Promise<DashboardResponseDto> {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(startOfToday);
    const weekday = startOfWeek.getDay();
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    startOfWeek.setDate(startOfWeek.getDate() - daysFromMonday);

    const periodStart =
      period === 'day'
        ? startOfToday
        : period === 'week'
          ? startOfWeek
          : period === 'month'
            ? startOfMonth
            : null;

    const createdAtFilter: { createdAt?: { gte: Date } } = periodStart
      ? { createdAt: { gte: periodStart } }
      : {};

    const chartStart = new Date(startOfToday);
    chartStart.setDate(chartStart.getDate() - (CHART_DAYS - 1));

    const [
      userStatusGroups,
      activeUsers,
      verifiedUsers,
      userGrowthRows,
      ideaGenerationGroups,
      unlockedIdeas,
      paymentStatusGroups,
      paymentPurposeGroups,
      comments,
      creditsSoldAggregate,
      aiGroups,
      complaintStatusGroups,
      generatedOutputs,
      todayIdeas,
      monthlyIdeas,
      todayPaymentGroups,
      monthlyPaymentGroups,
      recentUsers,
      recentPayments,
      recentIdeas,
      recentComplaints,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['accountStatus'],
        where: { deletedAt: null, role: UserRole.USER, ...createdAtFilter },
        _count: { _all: true },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          role: UserRole.USER,
          isActive: true,
          ...createdAtFilter,
        },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          role: UserRole.USER,
          isVerified: true,
          ...createdAtFilter,
        },
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          role: UserRole.USER,
          createdAt: {
            gte:
              startOfMonth.getTime() < chartStart.getTime()
                ? startOfMonth
                : chartStart,
          },
        },
        select: { createdAt: true },
      }),

      this.prisma.idea.groupBy({
        by: ['generationType'],
        where: { deletedAt: null, ...createdAtFilter },
        _count: { _all: true },
      }),
      this.prisma.idea.count({
        where: { deletedAt: null, isUnlocked: true, ...createdAtFilter },
      }),

      this.prisma.payment.groupBy({
        by: ['status'],
        where: createdAtFilter,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['paymentPurpose'],
        where: createdAtFilter,
        _count: { _all: true },
      }),

      this.prisma.socialComment.count({ where: createdAtFilter }),
      this.prisma.creditTransaction.aggregate({
        where: {
          type: {
            in: [CreditTransactionType.PURCHASE, CreditTransactionType.BONUS],
          },
          ...createdAtFilter,
        },
        _sum: { amount: true },
      }),

      this.prisma.externalApiLog.groupBy({
        by: ['isSuccess'],
        where: {
          requestType: { in: AI_REQUEST_TYPES },
          ...createdAtFilter,
        },
        _count: { _all: true, responseTimeMs: true },
        _sum: { costEstimate: true },
        _avg: { responseTimeMs: true },
      }),

      this.prisma.complaint.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...createdAtFilter },
        _count: { _all: true },
      }),

      this.prisma.generatedOutput.count({ where: createdAtFilter }),

      this.prisma.idea.count({
        where: { deletedAt: null, createdAt: { gte: startOfToday } },
      }),
      this.prisma.idea.count({
        where: { deletedAt: null, createdAt: { gte: startOfMonth } },
      }),

      this.prisma.payment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: startOfToday } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: startOfMonth } },
        _count: { _all: true },
        _sum: { amount: true },
      }),

      this.prisma.user.findMany({
        where: { deletedAt: null, role: UserRole.USER, ...createdAtFilter },
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
        where: createdAtFilter,
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          userId: true,
          ideaId: true,
          publicationId: true,
          amount: true,
          currency: true,
          paymentMethodKey: true,
          providerKey: true,
          paymentPurpose: true,
          status: true,
          creditsAmount: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.idea.findMany({
        where: { deletedAt: null, ...createdAtFilter },
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
        where: { deletedAt: null, ...createdAtFilter },
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

    const paymentTargetKey = (payment: (typeof recentPayments)[number]) => {
      if (
        payment.paymentPurpose !== PaymentPurpose.DIRECT_UNLOCK &&
        payment.paymentPurpose !== PaymentPurpose.ACCEPT_PUBLICATION &&
        payment.paymentPurpose !== PaymentPurpose.UNLOCK_PUBLICATION_ADVANCED
      ) {
        return '';
      }

      const targetId = payment.ideaId ?? payment.publicationId;
      return targetId
        ? `${payment.userId}|${payment.paymentPurpose}|${targetId}`
        : '';
    };

    const finalizedPaymentTargets = new Set(
      recentPayments
        .filter((payment) => payment.status === PaymentStatus.SUCCEEDED)
        .map(paymentTargetKey)
        .filter((key) => key.length > 0),
    );

    const dashboardRecentPayments = recentPayments
      .filter((payment) => {
        if (payment.status !== PaymentStatus.PENDING) {
          return true;
        }

        const key = paymentTargetKey(payment);
        return key.length === 0 || !finalizedPaymentTargets.has(key);
      })
      .slice(0, 5);

    const users = userStatusGroups.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const normalUsers =
      userStatusGroups.find((row) => row.accountStatus === AccountStatus.NORMAL)
        ?._count._all ?? 0;
    const premiumUsers =
      userStatusGroups.find((row) => row.accountStatus === AccountStatus.PREMIUM)
        ?._count._all ?? 0;

    const ideas = ideaGenerationGroups.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const guestIdeas =
      ideaGenerationGroups.find(
        (row) => row.generationType === IdeaGenerationType.GUEST_FREE,
      )?._count._all ?? 0;
    const normalFreeIdeas =
      ideaGenerationGroups.find(
        (row) => row.generationType === IdeaGenerationType.NORMAL_FREE,
      )?._count._all ?? 0;
    const premiumCreditIdeas =
      ideaGenerationGroups.find(
        (row) => row.generationType === IdeaGenerationType.PREMIUM_CREDIT,
      )?._count._all ?? 0;

    const paymentStatusMap = new Map(
      paymentStatusGroups.map((row) => [row.status, row] as const),
    );
    const paymentPurposeMap = new Map(
      paymentPurposeGroups.map((row) => [row.paymentPurpose, row] as const),
    );

    const payments = paymentStatusGroups.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const succeededPayments =
      paymentStatusMap.get(PaymentStatus.SUCCEEDED)?._count._all ?? 0;
    const pendingPayments =
      paymentStatusMap.get(PaymentStatus.PENDING)?._count._all ?? 0;
    const failedPayments =
      paymentStatusMap.get(PaymentStatus.FAILED)?._count._all ?? 0;
    const refundedPayments =
      paymentStatusMap.get(PaymentStatus.REFUNDED)?._count._all ?? 0;
    const directUnlockPayments =
      paymentPurposeMap.get(PaymentPurpose.DIRECT_UNLOCK)?._count._all ?? 0;
    const creditPurchasePayments =
      paymentPurposeMap.get(PaymentPurpose.BUY_CREDITS)?._count._all ?? 0;

    const revenueTotal = Number(
      paymentStatusMap.get(PaymentStatus.SUCCEEDED)?._sum.amount ?? 0,
    );
    const refundsTotal = Number(
      paymentStatusMap.get(PaymentStatus.REFUNDED)?._sum.amount ?? 0,
    );

    const aiRequests = aiGroups.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const failedAiRequests =
      aiGroups.find((row) => row.isSuccess === false)?._count._all ?? 0;
    const aiSuccessRate =
      aiRequests === 0
        ? 0
        : ((aiRequests - failedAiRequests) / aiRequests) * 100;

    const aiCost = aiGroups.reduce(
      (sum, row) => sum + Number(row._sum.costEstimate ?? 0),
      0,
    );
    const aiResponseSamples = aiGroups.reduce(
      (sum, row) => sum + row._count.responseTimeMs,
      0,
    );
    const aiResponseWeightedTotal = aiGroups.reduce(
      (sum, row) =>
        sum +
        Number(row._avg.responseTimeMs ?? 0) * row._count.responseTimeMs,
      0,
    );
    const averageResponseTime =
      aiResponseSamples === 0 ? 0 : aiResponseWeightedTotal / aiResponseSamples;

    const complaintStatusMap = new Map(
      complaintStatusGroups.map((row) => [row.status, row._count._all] as const),
    );

    const todayUsers = userGrowthRows.filter(
      (row) => row.createdAt >= startOfToday,
    ).length;
    const monthlyUsers = userGrowthRows.filter(
      (row) => row.createdAt >= startOfMonth,
    ).length;

    const getPaymentPeriodStats = (
      groups: typeof todayPaymentGroups,
    ): { payments: number; revenue: number } => {
      const paymentsCount = groups.reduce(
        (sum, row) => sum + row._count._all,
        0,
      );
      const succeeded = groups.find(
        (row) => row.status === PaymentStatus.SUCCEEDED,
      );
      return {
        payments: paymentsCount,
        revenue: Number(succeeded?._sum.amount ?? 0),
      };
    };

    const todayPayments = getPaymentPeriodStats(todayPaymentGroups);
    const monthlyPayments = getPaymentPeriodStats(monthlyPaymentGroups);

    const chartMap = new Map<string, number>();
    for (let offset = 0; offset < CHART_DAYS; offset += 1) {
      const day = new Date(chartStart);
      day.setDate(chartStart.getDate() + offset);
      chartMap.set(this.toDateKey(day), 0);
    }
    for (const row of userGrowthRows) {
      const key = this.toDateKey(row.createdAt);
      if (chartMap.has(key)) {
        chartMap.set(key, (chartMap.get(key) ?? 0) + 1);
      }
    }

    return {
      users,
      normalUsers,
      premiumUsers,
      activeUsers,
      inactiveUsers: Math.max(0, users - activeUsers),
      verifiedUsers,
      unverifiedUsers: Math.max(0, users - verifiedUsers),

      ideas,
      guestIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      unlockedIdeas,
      lockedIdeas: Math.max(0, ideas - unlockedIdeas),

      payments,
      successfulPaymentsCount: succeededPayments,
      pendingPaymentsCount: pendingPayments,
      failedPaymentsCount: failedPayments,
      refundedPaymentsCount: refundedPayments,
      directUnlockPaymentsCount: directUnlockPayments,
      creditPurchasePaymentsCount: creditPurchasePayments,

      comments,
      creditsSold: creditsSoldAggregate._sum.amount ?? 0,
      revenueTotal,
      refundsTotal,

      aiRequests,
      failedAiRequests,
      aiSuccessRate,
      aiErrorRate: aiRequests === 0 ? 0 : 100 - aiSuccessRate,
      averageResponseTime,
      aiCost,
      averageAiCostPerRequest: aiRequests === 0 ? 0 : aiCost / aiRequests,

      openComplaints: complaintStatusMap.get(ComplaintStatus.OPEN) ?? 0,
      inProgressComplaints:
        complaintStatusMap.get(ComplaintStatus.IN_PROGRESS) ?? 0,
      resolvedComplaints:
        complaintStatusMap.get(ComplaintStatus.RESOLVED) ?? 0,
      rejectedComplaints:
        complaintStatusMap.get(ComplaintStatus.REJECTED) ?? 0,

      generatedOutputs,
      generatedOutputsByKey: [],

      domainsStatus: { active: 0, inactive: 0 },
      dataSourcesStatus: { active: 0, inactive: 0 },

      todayStats: {
        users: todayUsers,
        ideas: todayIdeas,
        payments: todayPayments.payments,
        revenue: todayPayments.revenue,
      },
      monthlyStats: {
        users: monthlyUsers,
        ideas: monthlyIdeas,
        payments: monthlyPayments.payments,
        revenue: monthlyPayments.revenue,
      },

      usersGrowthChart: Array.from(chartMap.entries()).map(([date, count]) => ({
        date,
        count,
      })),
      usersByType: [],
      mostSelectedDomains: [],
      mostRequestedRegions: [],
      mostUsedDataSources: [],

      recentActivity: {
        recentUsers,
        recentPayments: dashboardRecentPayments.map((payment) => ({
          ...payment,
          amount: Number(payment.amount),
        })),
        recentIdeas,
        recentComplaints,
      },
    };
  }

  private normalizePeriod(value?: string): string {
    const normalized = value?.trim().toLowerCase();

    if (
      normalized === 'day' ||
      normalized === 'week' ||
      normalized === 'month'
    ) {
      return normalized;
    }

    return 'all';
  }

  private toDateKey(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}