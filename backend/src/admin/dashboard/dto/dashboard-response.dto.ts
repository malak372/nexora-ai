import {
  AccountStatus,
  ComplaintPriority,
  ComplaintStatus,
  IdeaGenerationType,
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

export class DashboardDataSourceChartDto {
  label!: string;
  dataSourceId!: string;
  dataSourceKey!: string | null;
  count!: number;
}

export class DashboardGeneratedOutputDto {
  label!: string;
  outputKey!: string;
  count!: number;
}

export class DashboardRecentUserDto {
  id!: string;
  fullName!: string;
  email!: string;
  role!: UserRole;
  accountStatus!: AccountStatus;
  userType!: UserType;
  isActive!: boolean;
  isVerified!: boolean;
  createdAt!: Date;
}

export class DashboardRecentPaymentDto {
  id!: string;
  amount!: number;
  currency!: string;
  paymentMethodKey!: string;
  providerKey!: string;
  paymentPurpose!: PaymentPurpose;
  status!: PaymentStatus;
  creditsAmount!: number;
  createdAt!: Date;
  user!: { id: string; fullName: string; email: string };
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
    userType: UserType;
  } | null;
  domain!: { id: string; name: string };
}

export class DashboardRecentComplaintDto {
  id!: string;
  subject!: string;
  status!: ComplaintStatus;
  priority!: ComplaintPriority;
  createdAt!: Date;
  user!: { id: string; fullName: string; email: string };
}

export class DashboardRecentActivityDto {
  recentUsers!: DashboardRecentUserDto[];
  recentPayments!: DashboardRecentPaymentDto[];
  recentIdeas!: DashboardRecentIdeaDto[];
  recentComplaints!: DashboardRecentComplaintDto[];
}

/** Complete administrative analytics response. */
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
  generatedOutputsByKey!: DashboardGeneratedOutputDto[];

  domainsStatus!: { active: number; inactive: number };
  dataSourcesStatus!: { active: number; inactive: number };

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
  mostUsedDataSources!: DashboardDataSourceChartDto[];
  recentActivity!: DashboardRecentActivityDto;
}
