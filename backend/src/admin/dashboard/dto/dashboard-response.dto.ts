import {
  AccountStatus,
  ComplaintPriority,
  ComplaintStatus,
  IdeaGenerationType,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  UserRole,
} from '@prisma/client';

/**
 * DTO representing user growth chart data.
 */
export class DashboardUserGrowthChartDto {
  date!: string;
  count!: number;
}

/**
 * DTO representing most selected domains chart data.
 */
export class DashboardDomainChartDto {
  label!: string;
  domainId!: string;
  domainName!: string | null;
  count!: number;
}

/**
 * DTO representing most requested regions chart data.
 */
export class DashboardRegionChartDto {
  label!: string;
  region!: string | null;
  count!: number;
}

/**
 * DTO representing most used platforms chart data.
 */
export class DashboardPlatformChartDto {
  label!: string;
  platformId!: string | null;
  platformName!: string | null;
  count!: number;
}

/**
 * DTO representing recently registered users.
 */
export class DashboardRecentUserDto {
  id!: string;
  fullName!: string;
  email!: string;
  role!: UserRole;
  accountStatus!: AccountStatus;
  isActive!: boolean;
  createdAt!: Date;
}

/**
 * DTO representing recent payments.
 */
export class DashboardRecentPaymentDto {
  id!: string;
  amount!: number;
  currency!: string;
  paymentMethod!: PaymentMethod;
  paymentPurpose!: PaymentPurpose;
  status!: PaymentStatus;
  creditsAmount!: number;
  createdAt!: Date;

  user!: {
    id: string;
    fullName: string;
    email: string;
  };
}

/**
 * DTO representing recently generated ideas.
 */
export class DashboardRecentIdeaDto {
  id!: string;
  title!: string;
  generationType!: IdeaGenerationType;
  isUnlocked!: boolean;
  selectedRegion!: string | null;
  createdAt!: Date;

  user!: {
    id: string;
    fullName: string;
    email: string;
  } | null;

  domain!: {
    id: string;
    name: string;
  }| null;
}

/**
 * DTO representing recent complaints.
 */
export class DashboardRecentComplaintDto {
  id!: string;
  subject!: string;
  status!: ComplaintStatus;
  priority!: ComplaintPriority;
  createdAt!: Date;

  user!: {
    id: string;
    fullName: string;
    email: string;
  };
}

/**
 * DTO representing all recent dashboard activity sections.
 */
export class DashboardRecentActivityDto {
  recentUsers!: DashboardRecentUserDto[];
  recentPayments!: DashboardRecentPaymentDto[];
  recentIdeas!: DashboardRecentIdeaDto[];
  recentComplaints!: DashboardRecentComplaintDto[];
}

/**
 * Main DTO representing the complete admin dashboard response.
 *
 * Includes:
 * - Main system counters.
 * - Payment and revenue statistics.
 * - AI usage statistics.
 * - Domain and platform status summaries.
 * - Today and monthly statistics.
 * - Chart-ready analytics.
 * - Recent platform activity.
 *
 * @author Malak
 */
export class DashboardResponseDto {
  users!: number;
  ideas!: number;
  payments!: number;
  comments!: number;

  creditsSold!: number;

  revenueTotal!: number;
  refundsTotal!: number;
  failedPaymentsCount!: number;

  aiRequests!: number;
  failedAiRequests!: number;
  aiErrorRate!: number;
  averageResponseTime!: number;
  aiCost!: number;

  domainsStatus!: {
    active: number;
    inactive: number;
  };

  platformsStatus!: {
    active: number;
    inactive: number;
  };

  todayStats!: {
    users: number;
    ideas: number;
    payments: number;
    revenue: number;
  };

  monthlyStats!: {
    users: number;
    ideas: number;
    payments: number;
    revenue: number;
  };

  usersGrowthChart!: DashboardUserGrowthChartDto[];
  mostSelectedDomains!: DashboardDomainChartDto[];
  mostRequestedRegions!: DashboardRegionChartDto[];
  mostUsedPlatforms!: DashboardPlatformChartDto[];

  recentActivity!: DashboardRecentActivityDto;
}