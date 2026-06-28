import { Injectable } from '@nestjs/common';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';

/**
 * Service responsible for Admin audit log management.
 *
 * This service allows the system to:
 * - Retrieve admin audit logs.
 * - Filter logs by admin, action, target type, or target ID.
 * - Paginate audit log results.
 * - Create new audit log records when an admin performs an action.
 *
 * Audit logs are used to track sensitive administrative actions
 * such as updating users, changing settings, managing domains,
 * managing platforms, sending alerts, and handling complaints.
 *
 * @author Malak
 */
@Injectable()
export class AuditLogsService {
  /**
   * Creates an instance of AuditLogsService.
   *
   * @param prisma - Prisma service used to access the database.
   */
  constructor(private readonly prisma: PrismaService) { }
  /**
   * Builds the Prisma sorting configuration for audit log queries.
   *
   * Maps the requested sorting field and direction
   * from the query parameters into a Prisma-compatible
   * orderBy object.
   *
   * If no sorting field is provided, audit logs are
   * sorted by creation date in descending order.
   *
   * @param query Query parameters containing the optional
   * sorting field and sorting direction.
   * @returns Prisma orderBy object used when retrieving audit logs.
   *
   * @author Malak
   */
  private buildAuditLogsOrderBy(query: GetAuditLogsQueryDto) {
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';

    switch (query.sortBy) {
      case 'action':
        return { action: sortOrder };

      case 'targetType':
        return { targetType: sortOrder };

      case 'targetId':
        return { targetId: sortOrder };

      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  /**
   * Retrieves admin audit logs with optional filtering and pagination.
   *
   * Supported filters:
   * - adminId: Filter logs by the admin who performed the action.
   * - action: Filter logs by the admin action type.
   * - targetType: Filter logs by the affected entity type.
   * - targetId: Filter logs by the affected entity ID.
   *
   * Pagination:
   * - page: Current page number. Default is 1.
   * - limit: Number of logs per page. Default is 10.
   *
   * Results are ordered by creation date in descending order,
   * so the newest logs appear first.
   *
   * @param query - Query parameters used for pagination and filtering audit logs.
   * @returns Paginated audit logs with metadata.
   */
  async getAuditLogs(query: GetAuditLogsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.AdminAuditLogWhereInput = {};

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate && {
          gte: new Date(query.fromDate),
        }),
        ...(query.toDate && {
          lte: new Date(query.toDate),
        }),
      };
    }

    if (query.adminId) {
      where.adminId = query.adminId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.targetType) {
      where.targetType = query.targetType;
    }

    if (query.targetId) {
      where.targetId = query.targetId;
    }


    const [logs, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.buildAuditLogsOrderBy(query),
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          oldValue: true,
          newValue: true,
          createdAt: true,
          admin: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      }),

      this.prisma.adminAuditLog.count({
        where,
      }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Creates a new audit log record.
   *
   * This method is intended to be called by other admin services
   * whenever an administrator performs an important action.
   *
   * The log stores:
   * - The admin who performed the action.
   * - The action type.
   * - The affected target type.
   * - The affected target ID.
   * - The old value before the change.
   * - The new value after the change.
   *
   * @param data - Audit log data describing the admin action.
   * @returns The created audit log record.
   */
  async createLog(data: {
    adminId?: string;
    action: AdminAction;
    targetType: AdminTargetType;
    targetId?: string;
    oldValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
  }) {
    return this.prisma.adminAuditLog.create({
      data: {
        adminId: data.adminId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        oldValue: data.oldValue,
        newValue: data.newValue,
      },
    });
  }
}