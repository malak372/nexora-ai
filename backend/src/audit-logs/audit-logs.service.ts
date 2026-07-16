import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../utilities/analytics/analytics.helper';

import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';

/**
 * Input required to create an audit-log record.
 *
 * Audit logs may be created by:
 * - An authenticated administrator.
 * - An authenticated user.
 * - An internal system process.
 *
 * The actor and target identifiers are nullable to support
 * system-generated operations and targets without a specific ID.
 *
 * @author Malak
 */
export type CreateAuditLogInput = {
  /**
   * Identifier of the user who performed the operation.
   *
   * Null or undefined represents an internal system action.
   */
  actorId?: string | null;

  /**
   * Type of operation that was performed.
   */
  action: AuditAction;

  /**
   * Type of entity affected by the operation.
   */
  targetType: AuditTargetType;

  /**
   * Optional identifier of the affected entity.
   */
  targetId?: string | null;

  /**
   * Entity state before the operation.
   */
  oldValue?: Prisma.InputJsonValue | null;

  /**
   * Entity state after the operation.
   */
  newValue?: Prisma.InputJsonValue | null;
};

/**
 * Shared service responsible for audit-log operations.
 *
 * Responsibilities:
 * - Create audit records.
 * - Participate in existing Prisma transactions.
 * - List, search, filter, sort, and paginate audit logs.
 * - Generate audit-log summaries.
 * - Generate chart-ready analytics.
 * - Export filtered logs as CSV.
 *
 * Audit records should be treated as append-only records.
 * Existing audit logs should not normally be modified or deleted.
 *
 * @author Malak
 */
@Injectable()
export class AuditService {
  /**
   * Maximum number of records included in one CSV export.
   *
   * Prevents an unbounded query from loading an excessive number
   * of audit records into application memory.
   */
  private static readonly MAX_CSV_EXPORT_ROWS = 50_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new audit-log record.
   *
   * When a transaction client is supplied, the audit record is
   * created inside the caller's existing database transaction.
   *
   * This ensures that:
   * - The business operation and its audit record both succeed.
   * - Or both operations are rolled back together.
   *
   * @param input Values stored in the audit record.
   * @param tx Optional Prisma transaction client.
   * @returns The newly created audit-log record.
   */
  async createLog(
    input: CreateAuditLogInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    return client.auditLog.create({
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
   * Returns paginated audit logs matching the supplied filters.
   *
   * The actor relation is included using a limited field selection
   * to avoid returning sensitive user data such as password hashes.
   *
   * @param query Filtering, searching, sorting, and pagination options.
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

      this.prisma.auditLog.count({
        where,
      }),
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
   * Returns summary counts for the filtered audit-log dataset.
   *
   * The same base filters are applied to:
   * - Total logs.
   * - Logs created by a user.
   * - Logs created by the internal system.
   *
   * Using AND prevents actor-specific filters from being accidentally
   * overwritten when calculating the summary breakdown.
   *
   * @param query Audit-log filters.
   */
  async getAuditLogsSummary(query: GetAuditLogsQueryDto) {
    const where = this.buildWhere(query);

    const [totalLogs, logsWithActor, logsWithoutActor] =
      await Promise.all([
        this.prisma.auditLog.count({
          where,
        }),

        this.prisma.auditLog.count({
          where: {
            AND: [
              where,
              {
                actorId: {
                  not: null,
                },
              },
            ],
          },
        }),

        this.prisma.auditLog.count({
          where: {
            AND: [
              where,
              {
                actorId: null,
              },
            ],
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
   * Returns chart-ready audit-log analytics.
   *
   * Results are grouped by:
   * - Audit action.
   * - Target entity type.
   *
   * @param query Audit-log filters.
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
        orderBy: {
          _count: {
            action: 'desc',
          },
        },
      }),

      this.prisma.auditLog.groupBy({
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
   *
   * A maximum record limit is applied to protect application memory
   * when the audit-log table contains a large number of rows.
   *
   * @param query Audit-log filters.
   * @returns CSV content.
   */
  async exportAuditLogsCsv(query: GetAuditLogsQueryDto) {
    const where = this.buildWhere(query);

    const logs = await this.prisma.auditLog.findMany({
      where,
      take: AuditService.MAX_CSV_EXPORT_ROWS,
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
   * Builds the shared Prisma where condition used by all
   * audit-log read and analytics endpoints.
   *
   * Supports:
   * - Date-range filtering.
   * - Actor filtering.
   * - Audit-action filtering.
   * - Target-type filtering.
   * - Target-ID filtering.
   * - Case-insensitive searching by target ID, actor name, or email.
   *
   * @param query Audit-log query options.
   */
  private buildWhere(
    query: GetAuditLogsQueryDto,
  ): Prisma.AuditLogWhereInput {
    const dateFilter = buildDateFilter(query);
    const search = query.search?.trim();

    return {
      ...(dateFilter ?? {}),

      ...(query.actorId
        ? {
            actorId: query.actorId,
          }
        : {}),

      ...(query.action
        ? {
            action: query.action,
          }
        : {}),

      ...(query.targetType
        ? {
            targetType: query.targetType,
          }
        : {}),

      ...(query.targetId
        ? {
            targetId: query.targetId,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                targetId: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                actor: {
                  is: {
                    fullName: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                actor: {
                  is: {
                    email: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  /**
   * Converts absent JSON values to a database NULL value.
   *
   * Prisma distinguishes between:
   * - Prisma.DbNull: the database column contains SQL NULL.
   * - Prisma.JsonNull: the column contains a JSON null value.
   *
   * For audit records, an omitted old or new value represents
   * missing data and is therefore stored as database NULL.
   *
   * @param value Optional JSON-compatible value.
   */
  private normalizeJsonValue(
    value?: Prisma.InputJsonValue | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === undefined || value === null
      ? Prisma.DbNull
      : value;
  }
}