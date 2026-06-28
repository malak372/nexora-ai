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

/**
 * Service responsible for Admin audit log management.
 *
 * This service allows the system to retrieve, filter,
 * sort, paginate, and create admin audit log records.
 *
 * @author Malak
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves admin audit logs with optional filtering,
   * sorting, and pagination.
   *
   * @param query Query parameters used for pagination,
   * filtering, and sorting audit logs.
   * @returns Paginated audit logs with metadata.
   */
  async getAuditLogs(query: GetAuditLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.AdminAuditLogWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('adminId', query.adminId),
      ...buildExactFilter('action', query.action),
      ...buildExactFilter('targetType', query.targetType),
      ...buildExactFilter('targetId', query.targetId),
    };

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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Creates a new audit log record.
   *
   * This method is called by admin services when an
   * administrator performs an important action.
   *
   * @param data Audit log data describing the admin action.
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