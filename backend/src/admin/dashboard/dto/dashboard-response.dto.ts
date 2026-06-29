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
 * Represents user growth chart item.
 *
 * @author Malak
 */
export class DashboardUserGrowthChartDto {
  /** Date grouped by day in YYYY-MM-DD format. */
  date!: string;

  /** Number of users registered on that date. */
  count!: number;
}

/**
 * Represents a dashboard chart item for domains.
 *
 * @author Malak
 */
export class DashboardDomainChartDto {
  /** Display label used by frontend charts. */
  label!: string;

  /** Domain identifier. */
  domainId!: string;

  /** Domain display name. */
  domainName!: string | null;

  /** Number of generated ideas for this domain. */
  count!: number;
}

/**
 * Represents a dashboard chart item for regions.
 *
 * @author Malak
 */
export class DashboardRegionChartDto {
  /** Display label used by frontend charts. */
  label!: string;

  /** Selected region name. */
  region!: string | null;

  /** Number of generated ideas for this region. */
  count!: number;
}

/**
 * Represents a dashboard chart item for platforms.
 *
 * @author Malak
 */
export class DashboardPlatformChartDto {
  /** Display label used by frontend charts. */
  label!: string;

  /** Platform identifier. */
  platformId!: string | null;

  /** Platform display name. */
  platformName!: string | null;

  /** Number of generated ideas for this platform. */
  count!: number;
}

/**
 * Represents a recently registered user item.
 *
 * @author Malak
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
 * Represents a recent payment item.
 *
 * @author Malak
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
 * Represents a recent generated idea item.
 *
 * @author Malak
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
  } | null;
}

/**
 * Represents a recent complaint item.
 *
 * @author Malak
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
 * Represents recent dashboard activity.
 *
 * @author Malak
 */
export class DashboardRecentActivityDto {
  recentUsers!: DashboardRecentUserDto[];
  recentPayments!: DashboardRecentPaymentDto[];
  recentIdeas!: DashboardRecentIdeaDto[];
  recentComplaints!: DashboardRecentComplaintDto[];
}

/**
 * DTO representing the Admin Dashboard response.
 *
 * This DTO matches DashboardService output exactly.
 * All financial and Decimal-based values are returned as plain numbers.
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
  openAiCost!: number;

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