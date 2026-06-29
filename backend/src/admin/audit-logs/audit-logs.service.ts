import { Injectable } from '@nestjs/common';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildRelationSearchFilter,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin audit log management.
 *
 * This service allows the system to:
 * - Retrieve audit logs.
 * - Search audit logs.
 * - Filter audit logs by admin, action, target type, target ID, and date.
 * - Sort and paginate audit log records.
 * - Generate audit log summary reports.
 * - Generate chart-ready audit log analytics.
 * - Create audit log records for sensitive admin actions.
 *
 * @author Malak
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma where filter for audit logs.
   *
   * This keeps list, summary, and charts consistent
   * when the same query filters are applied.
   */
  private buildAuditLogsWhere(
    query: GetAuditLogsQueryDto,
  ): Prisma.AdminAuditLogWhereInput {
    return {
      ...buildDateFilter(query),

      ...buildSearchFilter(['targetId'], query.search),

      ...buildRelationSearchFilter(
        'admin',
        ['fullName', 'email'],
        query.search,
      ),

      ...buildExactFilter('adminId', query.adminId),
      ...buildExactFilter('action', query.action),
      ...buildExactFilter('targetType', query.targetType),
      ...buildExactFilter('targetId', query.targetId),
    };
  }

  /**
   * Retrieves admin audit logs with optional filtering,
   * searching, sorting, and pagination.
   *
   * Endpoint:
   * GET /admin/audit-logs
   */
  async getAuditLogs(query: GetAuditLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildAuditLogsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['action', 'targetType', 'targetId', 'createdAt'] as const,
      'createdAt',
    );

    const [logs, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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

      this.prisma.adminAuditLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves audit log summary reports.
   *
   * Endpoint:
   * GET /admin/audit-logs/summary
   */
  async getAuditLogsSummary(query: GetAuditLogsQueryDto) {
    const where = this.buildAuditLogsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalLogs,
      todayLogs,
      thisMonthLogs,
      activeAdmins,
      actionsGroup,
      targetsGroup,
    ] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),

      this.prisma.adminAuditLog.count({
        where: {
          ...where,
          createdAt: {
            gte: todayStart,
          },
        },
      }),

      this.prisma.adminAuditLog.count({
        where: {
          ...where,
          createdAt: {
            gte: monthStart,
          },
        },
      }),

      this.prisma.adminAuditLog.groupBy({
        by: ['adminId'],
        where: {
          ...where,
          adminId: {
            not: null,
          },
        },
        _count: {
          adminId: true,
        },
      }),

      this.prisma.adminAuditLog.groupBy({
        by: ['action'],
        where,
        _count: {
          action: true,
        },
        orderBy: {
          _count: {
            action: 'desc',
          },
        },
        take: 1,
      }),

      this.prisma.adminAuditLog.groupBy({
        by: ['targetType'],
        where,
        _count: {
          targetType: true,
        },
        orderBy: {
          _count: {
            targetType: 'desc',
          },
        },
        take: 1,
      }),
    ]);

    return {
      totalLogs,
      todayLogs,
      thisMonthLogs,
      activeAdmins: activeAdmins.length,
      mostCommonAction: actionsGroup[0]
        ? {
            action: actionsGroup[0].action,
            count: actionsGroup[0]._count.action,
          }
        : null,
      mostAffectedTarget: targetsGroup[0]
        ? {
            targetType: targetsGroup[0].targetType,
            count: targetsGroup[0]._count.targetType,
          }
        : null,
    };
  }

  /**
   * Retrieves chart-ready audit log analytics.
   *
   * Endpoint:
   * GET /admin/audit-logs/charts
   *
   * Charts include:
   * - Logs by action.
   * - Logs by target type.
   * - Logs by admin.
   */
  async getAuditLogsCharts(query: GetAuditLogsQueryDto) {
    const where = this.buildAuditLogsWhere(query);

    const [logsByAction, logsByTargetType, logsByAdmin] =
      await Promise.all([
        this.prisma.adminAuditLog.groupBy({
          by: ['action'],
          where,
          _count: {
            action: true,
          },
          orderBy: {
            _count: {
              action: 'desc',
            },
          },
        }),

        this.prisma.adminAuditLog.groupBy({
          by: ['targetType'],
          where,
          _count: {
            targetType: true,
          },
          orderBy: {
            _count: {
              targetType: 'desc',
            },
          },
        }),

        this.prisma.adminAuditLog.groupBy({
          by: ['adminId'],
          where: {
            ...where,
            adminId: {
              not: null,
            },
          },
          _count: {
            adminId: true,
          },
          orderBy: {
            _count: {
              adminId: 'desc',
            },
          },
        }),
      ]);

    const adminIds = logsByAdmin
      .map((item) => item.adminId)
      .filter((id): id is string => Boolean(id));

    const admins = await this.prisma.user.findMany({
      where: {
        id: {
          in: adminIds,
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    const adminMap = new Map(
      admins.map((admin) => [admin.id, admin]),
    );

    return {
      logsByAction: logsByAction.map((item) => ({
        label: item.action,
        count: item._count.action,
      })),

      logsByTargetType: logsByTargetType.map((item) => ({
        label: item.targetType,
        count: item._count.targetType,
      })),

      logsByAdmin: logsByAdmin.map((item) => {
        const admin = item.adminId
          ? adminMap.get(item.adminId)
          : null;

        return {
          label: admin?.fullName ?? admin?.email ?? 'Unknown Admin',
          adminId: item.adminId,
          count: item._count.adminId,
        };
      }),
    };
  }

  /**
   * Creates a new audit log record.
   *
   * This method is called by admin services when an
   * administrator performs an important action.
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