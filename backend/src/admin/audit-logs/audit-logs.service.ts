import { Injectable } from '@nestjs/common';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { buildCsv, calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin audit log management.
 *
 * Supports retrieving, filtering, searching, sorting,
 * paginating, summarizing, charting, and creating audit logs.
 *
 * @author Malak
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Builds the shared Prisma where filter for audit logs.
   */
  private buildAuditLogsWhere(
    query: GetAuditLogsQueryDto,
  ): Prisma.AdminAuditLogWhereInput {
    const searchFilter: Prisma.AdminAuditLogWhereInput = query.search
      ? {
        OR: [
          {
            targetId: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            admin: {
              fullName: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          },
          {
            admin: {
              email: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          },
        ],
      }
      : {};

    return {
      ...buildDateFilter(query),
      ...searchFilter,
      ...buildExactFilter('adminId', query.adminId),
      ...buildExactFilter('action', query.action),
      ...buildExactFilter('targetType', query.targetType),
      ...buildExactFilter('targetId', query.targetId),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving existing date filters.
   */
  private mergeCreatedAtGte(
    where: Prisma.AdminAuditLogWhereInput,
    gte: Date,
  ): Prisma.AdminAuditLogWhereInput {
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
   * Retrieves admin audit logs with filtering, searching,
   * sorting, and pagination.
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
   */
  async getAuditLogsSummary(query: GetAuditLogsQueryDto) {
    const where = this.buildAuditLogsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

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
        where: todayWhere,
      }),

      this.prisma.adminAuditLog.count({
        where: monthWhere,
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

    const adminMap = new Map(admins.map((admin) => [admin.id, admin]));

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
        const admin = item.adminId ? adminMap.get(item.adminId) : null;

        return {
          label: admin?.fullName ?? admin?.email ?? 'Unknown Admin',
          adminId: item.adminId,
          count: item._count.adminId,
        };
      }),
    };
  }
  /**
   * Exports filtered audit logs as CSV.
   */
  async exportAuditLogsCsv(query: GetAuditLogsQueryDto) {
    const where = this.buildAuditLogsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['action', 'targetType', 'targetId', 'createdAt'] as const,
      'createdAt',
    );

    const logs = await this.prisma.adminAuditLog.findMany({
      where,
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
    });

    const headers = [
      'Log ID',
      'Admin ID',
      'Admin Name',
      'Admin Email',
      'Admin Role',
      'Action',
      'Target Type',
      'Target ID',
      'Old Value',
      'New Value',
      'Created At',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.admin?.id ?? '',
      log.admin?.fullName ?? '',
      log.admin?.email ?? '',
      log.admin?.role ?? '',
      log.action,
      log.targetType,
      log.targetId ?? '',
      JSON.stringify(log.oldValue ?? ''),
      JSON.stringify(log.newValue ?? ''),
      log.createdAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Creates a new audit log record.
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