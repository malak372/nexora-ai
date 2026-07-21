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

import { AuditService } from '../../audit-logs/audit-logs.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

import {
  buildCsv,
  calculateTotalPages,
  toNumber,
} from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { GetUsersQueryDto } from './dto/get-users-query.dto';

/**
 * Service responsible for administrative user-management operations.
 *
 * Responsibilities:
 * - Retrieve paginated users.
 * - Retrieve detailed user information.
 * - Produce user summary statistics.
 * - Produce chart-ready user analytics.
 * - Filter users by role, account status, user type, and activity state.
 * - Activate and deactivate user accounts.
 * - Soft-delete user accounts.
 * - Send password-reset emails on behalf of administrators.
 * - Export filtered user records as CSV.
 * - Create audit-log records for sensitive administrative actions.
 *
 * Security considerations:
 * - Administrators cannot modify their own status through this service.
 * - Administrators cannot deactivate or delete another administrator.
 * - Password-reset tokens are securely generated and stored as hashes.
 * - Deleted users are excluded by default unless explicitly requested.
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
   * Builds the shared Prisma filter used by administrative user queries.
   *
   * Supported filters:
   * - Creation date range.
   * - Search by full name or email address.
   * - User role.
   * - Account status.
   * - User type.
   * - Active status.
   * - Deleted-user inclusion.
   *
   * Soft-deleted users are excluded by default. They are included only when
   * the caller explicitly sets includeDeleted to true.
   *
   * @param query Administrative user query parameters.
   * @returns Prisma-compatible user filter.
   */
  private buildUsersWhere(query: GetUsersQueryDto): Prisma.UserWhereInput {
    const isActive =
      query.isActive !== undefined ? query.isActive === 'true' : undefined;

    const includeDeleted = query.includeDeleted === 'true';

    return {
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...buildDateFilter(query),
      ...buildSearchFilter(['fullName', 'email'], query.search),
      ...buildExactFilter('role', query.role),
      ...buildExactFilter('accountStatus', query.accountStatus),
      ...buildExactFilter('userType', query.userType),
      ...buildExactFilter('isActive', isActive),
    };
  }

  /**
   * Adds or replaces the minimum createdAt boundary in an existing filter.
   *
   * Existing createdAt conditions, such as an upper date boundary, are
   * preserved while the supplied minimum date is applied.
   *
   * Used for:
   * - Users created today.
   * - Users created during the current month.
   *
   * @param where Existing Prisma user filter.
   * @param gte Minimum creation date.
   * @returns Updated Prisma user filter.
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
   * Retrieves a paginated list of users for the admin dashboard.
   *
   * Endpoint:
   * GET /admin/users
   *
   * @param query Filtering, searching, sorting, and pagination parameters.
   * @returns Paginated users and pagination metadata.
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

      this.prisma.user.count({
        where,
      }),
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
   * Retrieves summary statistics for users matching the provided filters.
   *
   * Endpoint:
   * GET /admin/users/summary
   *
   * The summary includes:
   * - Total users.
   * - Active and inactive users.
   * - Verified and unverified users.
   * - Normal and premium accounts.
   * - Administrator accounts.
   * - Users created today.
   * - Users created during the current month.
   * - User counts grouped by user type.
   *
   * @param query Administrative user filters.
   * @returns User summary statistics.
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
      this.prisma.user.count({
        where,
      }),

      this.prisma.user.count({
        where: {
          ...where,
          isActive: true,
        },
      }),

      this.prisma.user.count({
        where: {
          ...where,
          isActive: false,
        },
      }),

      this.prisma.user.count({
        where: {
          ...where,
          isVerified: true,
        },
      }),

      this.prisma.user.count({
        where: {
          ...where,
          isVerified: false,
        },
      }),

      this.prisma.user.count({
        where: {
          ...where,
          accountStatus: AccountStatus.NORMAL,
        },
      }),

      this.prisma.user.count({
        where: {
          ...where,
          accountStatus: AccountStatus.PREMIUM,
        },
      }),

      this.prisma.user.count({
        where: {
          ...where,
          role: UserRole.ADMIN,
        },
      }),

      this.prisma.user.count({
        where: todayWhere,
      }),

      this.prisma.user.count({
        where: monthWhere,
      }),

      /**
       * Count all records in every user-type group.
       *
       * `_all` is intentionally used instead of `_count.userType`.
       * This produces a stable numeric result and avoids Prisma's conditional
       * aggregate type that may otherwise include `true` or `undefined`.
       */
      this.prisma.user.groupBy({
        by: ['userType'],
        where,
        _count: {
          _all: true,
        },
      }),
    ]);

    /**
     * Retrieves the number of users assigned to a specific user type.
     *
     * userType is required in the current Prisma schema, so no null handling
     * is needed for the grouped field.
     */
    const getUserTypeCount = (userType: UserType): number =>
      userTypesGroup.find((item) => item.userType === userType)?._count._all ??
      0;

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
      },
    };
  }

  /**
   * Retrieves chart-ready user analytics for the admin dashboard.
   *
   * Endpoint:
   * GET /admin/users/charts
   *
   * Returned chart datasets:
   * - Users grouped by role.
   * - Users grouped by account status.
   * - Users grouped by user type.
   * - Users grouped by active status.
   * - Users grouped by verification status.
   * - Top users by generated-idea count.
   * - Top users by payment count.
   *
   * @param query Administrative user filters.
   * @returns Chart-ready analytics collections.
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
        _count: {
          role: true,
        },
        orderBy: {
          _count: {
            role: 'desc',
          },
        },
      }),

      this.prisma.user.groupBy({
        by: ['accountStatus'],
        where,
        _count: {
          accountStatus: true,
        },
        orderBy: {
          _count: {
            accountStatus: 'desc',
          },
        },
      }),

      /**
       * userType is required by the current Prisma schema.
       *
       * A `not: null` filter must not be used because null is not assignable
       * to the generated UserType filter.
       */
      this.prisma.user.groupBy({
        by: ['userType'],
        where,
        _count: {
          _all: true,
        },
        orderBy: {
          _count: {
            userType: 'desc',
          },
        },
      }),

      this.prisma.user.groupBy({
        by: ['isActive'],
        where,
        _count: {
          isActive: true,
        },
        orderBy: {
          _count: {
            isActive: 'desc',
          },
        },
      }),

      this.prisma.user.groupBy({
        by: ['isVerified'],
        where,
        _count: {
          isVerified: true,
        },
        orderBy: {
          _count: {
            isVerified: 'desc',
          },
        },
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
        label: item.userType,
        userType: item.userType,
        count: item._count._all,
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
   * Retrieves detailed information for one user.
   *
   * Endpoint:
   * GET /admin/users/:id
   *
   * The response includes:
   * - User profile and account state.
   * - Recent generated ideas.
   * - Recent payments.
   * - Recent credit transactions.
   * - Recent complaints.
   * - Related-record counts.
   *
   * @param id User identifier.
   * @returns Detailed user information.
   *
   * @throws NotFoundException When the user does not exist.
   */
  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
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
          orderBy: {
            createdAt: 'desc',
          },
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
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            amount: true,
            currency: true,
            paymentMethodKey: true,
            paymentPurpose: true,
            status: true,
            creditsAmount: true,
            createdAt: true,
          },
        },

        creditTransactions: {
          take: 20,
          orderBy: {
            createdAt: 'desc',
          },
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
          orderBy: {
            createdAt: 'desc',
          },
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
   *
   * The same filtering and sorting behavior used by the administrative
   * users list is applied to the exported records.
   *
   * @param query Administrative user filters and sorting parameters.
   * @returns CSV-formatted user data.
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
      user.userType,
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
   * Business rules:
   * - An administrator cannot change their own status.
   * - An administrator cannot modify another administrator account.
   * - No database update is performed when the requested status is already set.
   * - Successful changes are written to the audit log.
   *
   * @param userId Target user identifier.
   * @param isActive Requested active status.
   * @param currentAdminId Authenticated administrator identifier.
   * @returns Updated user and operation status.
   *
   * @throws BadRequestException When an administrator targets themselves.
   * @throws BadRequestException When the target is another administrator.
   * @throws NotFoundException When the target user does not exist.
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
      where: {
        id: userId,
      },
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
      where: {
        id: userId,
      },
      data: {
        isActive,
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
   * Sends a password-reset email to a user.
   *
   * The raw password-reset token is sent to the user, while only its SHA-256
   * hash is persisted in the database.
   *
   * Business rules:
   * - An administrator cannot trigger this action for their own account.
   * - An administrator cannot trigger it for another administrator.
   * - The target account must be active.
   * - Existing unused password-reset tokens are invalidated first.
   * - The generated token expires after fifteen minutes.
   *
   * @param userId Target user identifier.
   * @param currentAdminId Authenticated administrator identifier.
   * @returns Operation result and target-user summary.
   *
   * @throws BadRequestException When the request violates an admin rule.
   * @throws NotFoundException When the target user does not exist.
   */
  async sendPasswordResetEmail(userId: string, currentAdminId: string) {
    if (userId === currentAdminId) {
      throw new BadRequestException(
        'Admin cannot send password reset email to own account from admin panel',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
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
   * Soft-deletes a user account.
   *
   * The record remains in the database. The account is marked as inactive
   * and receives a deletion timestamp.
   *
   * Business rules:
   * - An administrator cannot delete their own account.
   * - An administrator cannot delete another administrator account.
   * - Repeated deletion requests do not perform another update.
   * - Successful changes are written to the audit log.
   *
   * @param userId Target user identifier.
   * @param currentAdminId Authenticated administrator identifier.
   * @returns Updated user and operation status.
   *
   * @throws BadRequestException When an administrator targets themselves.
   * @throws BadRequestException When the target is another administrator.
   * @throws NotFoundException When the target user does not exist.
   */
  async softDeleteUser(userId: string, currentAdminId: string) {
    if (userId === currentAdminId) {
      throw new BadRequestException('Admin cannot delete own account');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot delete another admin account');
    }

    if (user.deletedAt !== null) {
      return {
        message: 'User is already soft deleted',
        user,
        updated: false,
      };
    }

    const deletedAt = new Date();

    const deletedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: false,
        deletedAt,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        userType: true,
        isActive: true,
        deletedAt: true,
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
        deletedAt: user.deletedAt,
      },
      newValue: {
        isActive: deletedUser.isActive,
        deletedAt: deletedUser.deletedAt,
      },
    });

    return {
      message: 'User soft deleted successfully',
      user: deletedUser,
      updated: true,
    };
  }
}
