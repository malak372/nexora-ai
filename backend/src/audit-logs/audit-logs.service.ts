import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../utilities/analytics/analytics.helper';

export type CreateAuditLogInput = {
  actorId?: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
};

/**
 * Shared audit service for the whole system.
 *
 * Responsibilities:
 * - Create audit logs.
 * - List audit logs.
 * - Filter audit logs.
 * - Generate audit summaries.
 * - Generate chart-ready analytics.
 * - Export audit logs as CSV.
 *
 * This service is general and not admin-specific.
 *
 * @author Malak
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Creates a new audit log record.
   *
   * Can be used by:
   * - Admin module.
   * - Data collection module.
   * - NLP module.
   * - Ideas module.
   * - Payments module.
   * - Any future system module.
   */
  async createLog(input: CreateAuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        oldValue: this.normalizeJsonValue(input.oldValue),
        newValue: this.normalizeJsonValue(input.newValue),
      },
    });
  }

  /**
   * Returns paginated and filtered audit logs.
   */
  async getAuditLogs(query: GetAuditLogsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);
    const where = this.buildWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'action', 'targetType', 'targetId'],
      'createdAt',
    );

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }
  /**
   * Returns summary counts for audit logs.
   */
  async getAuditLogsSummary(query: GetAuditLogsQueryDto) {
    const where = this.buildWhere(query);

    const [totalLogs, logsWithActor, logsWithoutActor] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.count({
        where: {
          ...where,
          actorId: {
            not: null,
          },
        },
      }),
      this.prisma.auditLog.count({
        where: {
          ...where,
          actorId: null,
        },
      }),
    ]);

    return {
      totalLogs,
      logsWithActor,
      logsWithoutActor,
    };
  }

  /**
   * Returns chart-ready audit log analytics.
   */
  async getAuditLogsCharts(query: GetAuditLogsQueryDto) {
    const where = this.buildWhere(query);

    const [byAction, byTargetType] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where,
        _count: {
          action: true,
        },
      }),
      this.prisma.auditLog.groupBy({
        by: ['targetType'],
        where,
        _count: {
          targetType: true,
        },
      }),
    ]);

    return {
      byAction: byAction.map((item) => ({
        action: item.action,
        count: item._count.action,
      })),
      byTargetType: byTargetType.map((item) => ({
        targetType: item.targetType,
        count: item._count.targetType,
      })),
    };
  }

  /**
   * Exports filtered audit logs as CSV.
   */
  async exportAuditLogsCsv(query: GetAuditLogsQueryDto) {
    const where = this.buildWhere(query);

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        actor: {
          select: {
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return buildCsv(
      [
        'ID',
        'Actor Name',
        'Actor Email',
        'Actor Role',
        'Action',
        'Target Type',
        'Target ID',
        'Old Value',
        'New Value',
        'Created At',
      ],
      logs.map((log) => [
        log.id,
        log.actor?.fullName ?? 'SYSTEM',
        log.actor?.email ?? '',
        log.actor?.role ?? '',
        log.action,
        log.targetType,
        log.targetId ?? '',
        JSON.stringify(log.oldValue ?? {}),
        JSON.stringify(log.newValue ?? {}),
        log.createdAt.toISOString(),
      ]),
    );
  }

  /**
   * Builds Prisma where filter for audit logs.
   */
  private buildWhere(query: GetAuditLogsQueryDto): Prisma.AuditLogWhereInput {
    const dateFilter = buildDateFilter(query);

    return {
      ...(dateFilter ?? {}),
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.action && { action: query.action }),
      ...(query.targetType && { targetType: query.targetType }),
      ...(query.targetId && { targetId: query.targetId }),
      ...(query.search?.trim()
        ? {
          OR: [
            {
              targetId: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              actor: {
                fullName: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
            {
              actor: {
                email: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
          ],
        }
        : {}),
    };
  }

  /**
   * Normalizes nullable JSON values for Prisma.
   */
  private normalizeJsonValue(
    value?: Prisma.InputJsonValue | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === undefined || value === null
      ? Prisma.JsonNull
      : value;
  }
}