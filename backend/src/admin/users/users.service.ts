import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminAction,
  AdminTargetType,
  Prisma,
  UserRole,
} from '@prisma/client';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';
import { PrismaService } from '../../prisma/prisma.service';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Service responsible for Admin user management operations.
 *
 * This service allows administrators to:
 * - View, search, and filter users.
 * - View detailed user information.
 * - Activate or deactivate user accounts.
 * - Soft delete user accounts.
 * - Record audit logs for sensitive user changes.
 *
 * @author Malak
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  /**
   * Retrieves users with optional search, filtering, and pagination.
   *
   * Read-only operation, so it is not recorded in audit logs.
   *
   * @param query - Query parameters used for pagination, searching, and filtering users.
   * @returns Paginated users list with metadata.
   */
  async getUsers(query: GetUsersQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true'
        : undefined;

    const where: Prisma.UserWhereInput = {
      ...buildDateFilter(query),
      ...buildSearchFilter(['fullName', 'email'], query.search),
      ...buildExactFilter('role', query.role),
      ...buildExactFilter('accountStatus', query.accountStatus),
      ...buildExactFilter('isActive', isActive),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'fullName',
        'email',
        'role',
        'accountStatus',
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
          creditBalance: true,
          freeGenerationsUsed: true,
          freeGenerationLimit: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
          _count: {
            select: {
              ideas: true,
              payments: true,
              creditTransactions: true,
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves detailed information for a specific user.
   *
   * Read-only operation, so it is not recorded in audit logs.
   *
   * @param id - ID of the user to retrieve.
   * @returns Detailed user information.
   *
   * @throws NotFoundException if the user does not exist.
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
        creditBalance: true,
        freeGenerationsUsed: true,
        freeGenerationLimit: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        ideas: {
          select: {
            id: true,
            title: true,
            generationType: true,
            isUnlocked: true,
            unlockMethod: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        payments: {
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
          orderBy: {
            createdAt: 'desc',
          },
        },
        creditTransactions: {
          select: {
            id: true,
            type: true,
            amount: true,
            balanceAfter: true,
            description: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Activates or deactivates a user account and records the action
   * in audit logs.
   *
   * Business rules:
   * - An admin cannot change their own status.
   * - An admin cannot modify another admin account.
   *
   * @param userId - ID of the user whose status will be updated.
   * @param isActive - New active status of the user.
   * @param currentAdminId - ID of the authenticated admin.
   * @returns The updated user status.
   *
   * @throws BadRequestException if the action is not allowed.
   * @throws NotFoundException if the user does not exist.
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
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditLogsService.createLog({
      adminId: currentAdminId,
      action: AdminAction.ADMIN_UPDATE_USER_STATUS,
      targetType: AdminTargetType.USER,
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
    };
  }

  /**
   * Soft deletes a user account by deactivating it and records
   * the action in audit logs.
   *
   * Business rules:
   * - An admin cannot delete their own account.
   * - An admin cannot delete another admin account.
   *
   * @param userId - ID of the user to soft delete.
   * @param currentAdminId - ID of the authenticated admin.
   * @returns The deactivated user account.
   *
   * @throws BadRequestException if the action is not allowed.
   * @throws NotFoundException if the user does not exist.
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

    const deletedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: false,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditLogsService.createLog({
      adminId: currentAdminId,
      action: AdminAction.ADMIN_SOFT_DELETE_USER,
      targetType: AdminTargetType.USER,
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
    };
  }
}