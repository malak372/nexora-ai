import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AuditAction,
  AuditTargetType,
  Prisma,
  UserRole,
  UserType,
} from '@prisma/client';
import * as crypto from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { MailService } from '../../mail/mail.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
  toNumber,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin user management operations.
 *
 * Provides:
 * - Paginated users list.
 * - User details.
 * - User summary reports.
 * - Chart-ready user analytics.
 * - User type filtering and analytics.
 * - Activate/deactivate users.
 * - Soft delete users.
 * - Send password reset emails.
 * - CSV export.
 * - Audit logging for sensitive actions.
 *
 * @author Malak
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Builds the shared Prisma where filter for users.
   *
   * Applies:
   * - Date range filters.
   * - Search by full name or email.
   * - Role filter.
   * - Account status filter.
   * - User type filter.
   * - Active status filter.
   */
  private buildUsersWhere(query: GetUsersQueryDto): Prisma.UserWhereInput {
    const isActive =
      query.isActive !== undefined ? query.isActive === 'true' : undefined;

    return {
      ...buildDateFilter(query),
      ...buildSearchFilter(['fullName', 'email'], query.search),
      ...buildExactFilter('role', query.role),
      ...buildExactFilter('accountStatus', query.accountStatus),
      ...buildExactFilter('userType', query.userType),
      ...buildExactFilter('isActive', isActive),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving existing date filters.
   *
   * Used for:
   * - Users created today.
   * - Users created this month.
   */
  private mergeCreatedAtGte(
    where: Prisma.UserWhereInput,
    gte: Date,
  ): Prisma.UserWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' && where.createdAt !== null
        ? where.createdAt
        : {};

    return {
      ...where,
      createdAt: {
        ...existingCreatedAt,
        gte,
      },
    };
  }

  /**
   * Retrieves a paginated list of users.
   *
   * Endpoint:
   * GET /admin/users
   */
  async getUsers(query: GetUsersQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildUsersWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'fullName',
        'email',
        'role',
        'accountStatus',
        'userType',
        'creditBalance',
        'isActive',
        'isVerified',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          accountStatus: true,
          userType: true,
          creditBalance: true,
          freeGenerationsUsed: true,
          freeGenerationLimit: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              ideas: true,
              payments: true,
              creditTransactions: true,
              complaints: true,
            },
          },
        },
      }),

      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves summary statistics for users.
   *
   * Endpoint:
   * GET /admin/users/summary
   */
  async getUsersSummary(query: GetUsersQueryDto) {
    const where = this.buildUsersWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalUsers,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      unverifiedUsers,
      normalUsers,
      premiumUsers,
      adminUsers,
      todayUsers,
      thisMonthUsers,
      userTypesGroup,
    ] = await Promise.all([
      this.prisma.user.count({ where }),

      this.prisma.user.count({
        where: { ...where, isActive: true },
      }),

      this.prisma.user.count({
        where: { ...where, isActive: false },
      }),

      this.prisma.user.count({
        where: { ...where, isVerified: true },
      }),

      this.prisma.user.count({
        where: { ...where, isVerified: false },
      }),

      this.prisma.user.count({
        where: { ...where, accountStatus: AccountStatus.NORMAL },
      }),

      this.prisma.user.count({
        where: { ...where, accountStatus: AccountStatus.PREMIUM },
      }),

      this.prisma.user.count({
        where: { ...where, role: UserRole.ADMIN },
      }),

      this.prisma.user.count({ where: todayWhere }),

      this.prisma.user.count({ where: monthWhere }),

      this.prisma.user.groupBy({
        by: ['userType'],
        where,
        _count: {
          userType: true,
        },
      }),
    ]);

    const getUserTypeCount = (userType: UserType | null) =>
      userTypesGroup.find((item) => item.userType === userType)?._count
        .userType ?? 0;

    return {
      totalUsers,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      unverifiedUsers,
      normalUsers,
      premiumUsers,
      adminUsers,
      todayUsers,
      thisMonthUsers,
      userTypes: {
        studentUsers: getUserTypeCount(UserType.STUDENT),
        developerUsers: getUserTypeCount(UserType.DEVELOPER),
        companyUsers: getUserTypeCount(UserType.COMPANY),
        researcherUsers: getUserTypeCount(UserType.RESEARCHER),
        otherUsers: getUserTypeCount(UserType.OTHER),
        unknownTypeUsers: getUserTypeCount(null),
      },
    };
  }

  /**
   * Retrieves chart-ready user analytics.
   *
   * Endpoint:
   * GET /admin/users/charts
   */
  async getUsersCharts(query: GetUsersQueryDto) {
    const where = this.buildUsersWhere(query);

    const [
      usersByRole,
      usersByAccountStatus,
      usersByType,
      usersByActiveStatus,
      usersByVerificationStatus,
      topUsersByIdeas,
      topUsersByPayments,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where,
        _count: { role: true },
        orderBy: { _count: { role: 'desc' } },
      }),

      this.prisma.user.groupBy({
        by: ['accountStatus'],
        where,
        _count: { accountStatus: true },
        orderBy: { _count: { accountStatus: 'desc' } },
      }),

      this.prisma.user.groupBy({
        by: ['userType'],
        where: {
          ...where,
          userType: {
            not: null,
          },
        },
        _count: { userType: true },
        orderBy: { _count: { userType: 'desc' } },
      }),

      this.prisma.user.groupBy({
        by: ['isActive'],
        where,
        _count: { isActive: true },
        orderBy: { _count: { isActive: 'desc' } },
      }),

      this.prisma.user.groupBy({
        by: ['isVerified'],
        where,
        _count: { isVerified: true },
        orderBy: { _count: { isVerified: 'desc' } },
      }),

      this.prisma.user.findMany({
        where,
        orderBy: {
          ideas: {
            _count: 'desc',
          },
        },
        take: 10,
        select: {
          id: true,
          fullName: true,
          email: true,
          userType: true,
          _count: {
            select: {
              ideas: true,
            },
          },
        },
      }),

      this.prisma.user.findMany({
        where,
        orderBy: {
          payments: {
            _count: 'desc',
          },
        },
        take: 10,
        select: {
          id: true,
          fullName: true,
          email: true,
          userType: true,
          _count: {
            select: {
              payments: true,
            },
          },
        },
      }),
    ]);

    return {
      usersByRole: usersByRole.map((item) => ({
        label: item.role,
        role: item.role,
        count: item._count.role,
      })),

      usersByAccountStatus: usersByAccountStatus.map((item) => ({
        label: item.accountStatus,
        accountStatus: item.accountStatus,
        count: item._count.accountStatus,
      })),

      usersByType: usersByType.map((item) => ({
        label: item.userType ?? 'UNKNOWN',
        userType: item.userType,
        count: item._count.userType,
      })),

      usersByActiveStatus: usersByActiveStatus.map((item) => ({
        label: item.isActive ? 'ACTIVE' : 'INACTIVE',
        isActive: item.isActive,
        count: item._count.isActive,
      })),

      usersByVerificationStatus: usersByVerificationStatus.map((item) => ({
        label: item.isVerified ? 'VERIFIED' : 'UNVERIFIED',
        isVerified: item.isVerified,
        count: item._count.isVerified,
      })),

      topUsersByIdeas: topUsersByIdeas.map((user) => ({
        label: user.fullName ?? user.email,
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        userType: user.userType,
        count: user._count.ideas,
      })),

      topUsersByPayments: topUsersByPayments.map((user) => ({
        label: user.fullName ?? user.email,
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        userType: user.userType,
        count: user._count.payments,
      })),
    };
  }

  /**
   * Retrieves detailed information for a specific user.
   *
   * Endpoint:
   * GET /admin/users/:id
   */
  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        userType: true,
        creditBalance: true,
        freeGenerationsUsed: true,
        freeGenerationLimit: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,

        ideas: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            generationType: true,
            isUnlocked: true,
            unlockMethod: true,
            createdAt: true,
          },
        },

        payments: {
          take: 20,
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
          },
        },

        creditTransactions: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            amount: true,
            balanceAfter: true,
            description: true,
            createdAt: true,
          },
        },

        complaints: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            subject: true,
            status: true,
            priority: true,
            createdAt: true,
          },
        },

        _count: {
          select: {
            ideas: true,
            payments: true,
            creditTransactions: true,
            complaints: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      payments: user.payments.map((payment) => ({
        ...payment,
        amount: toNumber(payment.amount),
      })),
    };
  }

  /**
   * Exports filtered users as CSV.
   *
   * Endpoint:
   * GET /admin/users/export/csv
   */
  async exportUsersCsv(query: GetUsersQueryDto) {
    const where = this.buildUsersWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'fullName',
        'email',
        'role',
        'accountStatus',
        'userType',
        'creditBalance',
        'isActive',
        'isVerified',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const users = await this.prisma.user.findMany({
      where,
      orderBy,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        userType: true,
        creditBalance: true,
        freeGenerationsUsed: true,
        freeGenerationLimit: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            ideas: true,
            payments: true,
            creditTransactions: true,
            complaints: true,
          },
        },
      },
    });

    const headers = [
      'User ID',
      'Full Name',
      'Email',
      'Role',
      'Account Status',
      'User Type',
      'Credit Balance',
      'Free Generations Used',
      'Free Generation Limit',
      'Is Active',
      'Is Verified',
      'Ideas Count',
      'Payments Count',
      'Credit Transactions Count',
      'Complaints Count',
      'Created At',
      'Updated At',
    ];

    const rows = users.map((user) => [
      user.id,
      user.fullName,
      user.email,
      user.role,
      user.accountStatus,
      user.userType ?? '',
      user.creditBalance,
      user.freeGenerationsUsed,
      user.freeGenerationLimit,
      user.isActive,
      user.isVerified,
      user._count.ideas,
      user._count.payments,
      user._count.creditTransactions,
      user._count.complaints,
      user.createdAt.toISOString(),
      user.updatedAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Updates a user's active status.
   *
   * Prevents admins from changing their own status
   * or modifying another admin account.
   */
  async updateUserStatus(
    userId: string,
    isActive: boolean,
    currentAdminId: string,
  ) {
    if (userId === currentAdminId) {
      throw new BadRequestException('Admin cannot change own status');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot modify another admin account');
    }

    if (user.isActive === isActive) {
      return {
        message: 'No changes detected',
        user,
        updated: false,
      };
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        userType: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditLogsService.createLog({
      actorId: currentAdminId,
      action: AuditAction.ADMIN_UPDATE_USER_STATUS,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: {
        isActive: user.isActive,
      },
      newValue: {
        isActive: updatedUser.isActive,
      },
    });

    return {
      message: isActive
        ? 'User activated successfully'
        : 'User deactivated successfully',
      user: updatedUser,
      updated: true,
    };
  }

  /**
   * Sends a password reset email to a user.
   *
   * Uses the PasswordResetToken table instead of storing
   * reset token fields directly on the User table.
   */
  async sendPasswordResetEmail(userId: string, currentAdminId: string) {
    if (userId === currentAdminId) {
      throw new BadRequestException(
        'Admin cannot send password reset email to own account from admin panel',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Cannot send password reset email to another admin account',
      );
    }

    if (!user.isActive) {
      throw new BadRequestException(
        'Cannot send password reset email to inactive user',
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');

    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.passwordResetToken.deleteMany({
      where: {
        userId,
        usedAt: null,
      },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashedToken,
        expiresAt,
      },
    });

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

    await this.mailService.sendPasswordResetEmail(user.email, resetLink);

    await this.auditLogsService.createLog({
      actorId: currentAdminId,
      action: AuditAction.ADMIN_SEND_PASSWORD_RESET_EMAIL,
      targetType: AuditTargetType.USER,
      targetId: user.id,
      newValue: {
        userId: user.id,
        email: user.email,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      message: 'Password reset email sent successfully',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
    };
  }

  /**
   * Soft deletes a user account.
   *
   * The user is not removed from the database.
   * Instead, the account is marked as inactive.
   *
   * Prevents admins from deleting their own account
   * or deleting another admin account.
   */
  async softDeleteUser(userId: string, currentAdminId: string) {
    if (userId === currentAdminId) {
      throw new BadRequestException('Admin cannot delete own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot delete another admin account');
    }

    if (!user.isActive) {
      return {
        message: 'User is already inactive',
        user,
        updated: false,
      };
    }

    const deletedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        userType: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditLogsService.createLog({
      actorId: currentAdminId,
      action: AuditAction.ADMIN_SOFT_DELETE_USER,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: {
        isActive: user.isActive,
      },
      newValue: {
        isActive: deletedUser.isActive,
      },
    });

    return {
      message: 'User soft deleted successfully',
      user: deletedUser,
      updated: true,
    };
  }
}
