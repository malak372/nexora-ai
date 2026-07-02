import {
  AccountStatus,
  ComplaintPriority,
  ComplaintStatus,
  GeneratedOutputType,
  IdeaGenerationType,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  UserRole,
  UserType,
} from '@prisma/client';

export class DashboardUserGrowthChartDto {
  date!: string;
  count!: number;
}

export class DashboardUserTypeChartDto {
  label!: string;
  userType!: UserType | null;
  count!: number;
}

export class DashboardDomainChartDto {
  label!: string;
  domainId!: string;
  domainName!: string | null;
  count!: number;
}

export class DashboardRegionChartDto {
  label!: string;
  region!: string | null;
  count!: number;
}

export class DashboardPlatformChartDto {
  label!: string;
  platformId!: string | null;
  platformName!: string | null;
  count!: number;
}

export class DashboardGeneratedOutputTypeDto {
  label!: string;
  outputType!: GeneratedOutputType;
  count!: number;
}

export class DashboardRecentUserDto {
  id!: string;
  fullName!: string;
  email!: string;
  role!: UserRole;
  accountStatus!: AccountStatus;
  userType!: UserType | null;
  isActive!: boolean;
  isVerified!: boolean;
  createdAt!: Date;
}

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
    userType: UserType | null;
  } | null;

  domain!: {
    id: string;
    name: string;
  } | null;
}

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

export class DashboardRecentActivityDto {
  recentUsers!: DashboardRecentUserDto[];
  recentPayments!: DashboardRecentPaymentDto[];
  recentIdeas!: DashboardRecentIdeaDto[];
  recentComplaints!: DashboardRecentComplaintDto[];
}

/**
 * Main DTO representing the complete Admin dashboard response.
 *
 * @author Malak
 */
export class DashboardResponseDto {
  users!: number;
  normalUsers!: number;
  premiumUsers!: number;
  activeUsers!: number;
  inactiveUsers!: number;
  verifiedUsers!: number;
  unverifiedUsers!: number;

  ideas!: number;
  guestIdeas!: number;
  normalFreeIdeas!: number;
  premiumCreditIdeas!: number;
  unlockedIdeas!: number;
  lockedIdeas!: number;

  payments!: number;
  successfulPaymentsCount!: number;
  pendingPaymentsCount!: number;
  failedPaymentsCount!: number;
  refundedPaymentsCount!: number;
  directUnlockPaymentsCount!: number;
  creditPurchasePaymentsCount!: number;

  comments!: number;

  creditsSold!: number;
  creditPurchases!: number;
  creditRefunds!: number;
  manualCreditAdjustments!: number;
  averageCreditsPerPremiumUser!: number;

  revenueTotal!: number;
  refundsTotal!: number;

  aiRequests!: number;
  failedAiRequests!: number;
  aiSuccessRate!: number;
  aiErrorRate!: number;
  averageResponseTime!: number;
  aiCost!: number;
  averageAiCostPerRequest!: number;

  openComplaints!: number;
  inProgressComplaints!: number;
  resolvedComplaints!: number;
  rejectedComplaints!: number;

  generatedOutputs!: number;
  generatedOutputsByType!: DashboardGeneratedOutputTypeDto[];

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
  usersByType!: DashboardUserTypeChartDto[];

  mostSelectedDomains!: DashboardDomainChartDto[];
  mostRequestedRegions!: DashboardRegionChartDto[];
  mostUsedPlatforms!: DashboardPlatformChartDto[];

  recentActivity!: DashboardRecentActivityDto;
}