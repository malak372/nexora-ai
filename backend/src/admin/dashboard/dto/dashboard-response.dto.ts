import { Decimal } from '@prisma/client/runtime/library';

/**
 * DTO representing the Admin dashboard response.
 *
 * This DTO must match DashboardService output exactly.
 *
 * It contains:
 * - General platform statistics.
 * - Payment and revenue summaries.
 * - AI usage analytics.
 * - Domain and platform status counts.
 * - Daily and monthly statistics.
 * - Chart-ready analytics data.
 * - Recent admin dashboard activity.
 *
 * @author Malak
 */
export class DashboardResponseDto {
  /** Total number of users in the system. */
  users!: number;

  /** Total number of generated ideas. */
  ideas!: number;

  /** Total number of payment records. */
  payments!: number;

  /** Total number of collected comments. */
  comments!: number;

  /** Total number of credits sold through successful payments. */
  creditsSold!: number;

  /** Total successful revenue amount. */
  revenueTotal!: number | Decimal;

  /** Total refunded payment amount. */
  refundsTotal!: number | Decimal;

  /** Total number of failed payments. */
  failedPaymentsCount!: number;

  /** Total number of external AI API requests. */
  aiRequests!: number;

  /** Total number of failed AI API requests. */
  failedAiRequests!: number;

  /** AI request failure percentage. */
  aiErrorRate!: number;

  /** Average AI API response time in milliseconds. */
  averageResponseTime!: number;

  /** Estimated total OpenAI API cost. */
  openAiCost!: number | Decimal;

  /** Active and inactive domain counts. */
  domainsStatus!: {
    active: number;
    inactive: number;
  };

  /** Active and inactive platform counts. */
  platformsStatus!: {
    active: number;
    inactive: number;
  };

  /** Dashboard statistics for the current day. */
  todayStats!: {
    users: number;
    ideas: number;
    payments: number;
    revenue: number | Decimal;
  };

  /** Dashboard statistics for the current month. */
  monthlyStats!: {
    users: number;
    ideas: number;
    payments: number;
    revenue: number | Decimal;
  };

  /** Chart-ready user growth data grouped by date. */
  usersGrowthChart!: any[];

  /** Top selected domains with usage count. */
  mostSelectedDomains!: any[];

  /** Top requested regions with usage count. */
  mostRequestedRegions!: any[];

  /** Top used platforms with usage count. */
  mostUsedPlatforms!: any[];

  /** Recent dashboard activity records. */
  recentActivity!: {
    recentUsers: any[];
    recentPayments: any[];
    recentIdeas: any[];
    recentComplaints: any[];
  };
}