import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  ComplaintPriority,
  ComplaintStatus,
  Prisma,
} from '@prisma/client';

import type { Cache } from 'cache-manager';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import { userCacheKeys } from '../../users/cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../../utilities/analytics/analytics.helper';

import { GetAdminComplaintsQueryDto } from '../dto/get-admin-complaints-query.dto';
import { UpdateComplaintDto } from '../dto/update-complaint.dto';

import { resolveComplaintResolvedAt } from '../utils/complaint-status.util';

/**
 * Handles administrator complaint-management operations.
 *
 * Responsibilities:
 * - List active complaints.
 * - Search, filter, sort, and paginate complaints.
 * - Generate summary statistics.
 * - Generate chart-ready analytics.
 * - Export active complaints as CSV.
 * - Update complaint status, priority, and administrator reply.
 * - Record complaint updates in audit logs.
 * - Invalidate affected user caches.
 *
 * Soft-deleted complaints are excluded from normal administrator
 * operations and analytics.
 *
 * @author Malak
 */
@Injectable()
export class AdminComplaintsService {
  /**
   * Maximum number of complaints returned by one CSV export.
   *
   * Prevents an unbounded query from loading excessive data
   * into application memory.
   */
  private static readonly MAX_CSV_EXPORT_ROWS = 50_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Shared administrator complaint selection.
   */
  private readonly complaintSelect = {
    id: true,
    subject: true,
    message: true,
    status: true,
    priority: true,
    adminReply: true,
    createdAt: true,
    updatedAt: true,
    resolvedAt: true,

    user: {
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    },

    idea: {
      select: {
        id: true,
        title: true,
      },
    },
  } satisfies Prisma.ComplaintSelect;

  /**
   * Returns paginated active complaints for administrator monitoring.
   *
   * @param query Filtering, sorting, and pagination options.
   */
  async getComplaints(query: GetAdminComplaintsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildComplaintsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['updatedAt', 'resolvedAt', 'status', 'priority', 'createdAt'] as const,
      'createdAt',
    );

    const [complaints, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy,
        select: this.complaintSelect,
      }),

      this.prisma.complaint.count({
        where,
      }),
    ]);

    return {
      data: complaints,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Returns complaint summary metrics.
   *
   * Every breakdown respects the base filters supplied by the
   * administrator. AND is used so status and priority conditions
   * do not accidentally overwrite query filters.
   *
   * @param query Complaint filters.
   */
  async getComplaintsSummary(query: GetAdminComplaintsQueryDto) {
    const where = this.buildComplaintsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalComplaints,
      todayComplaints,
      thisMonthComplaints,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      rejectedComplaints,
      highPriorityComplaints,
    ] = await Promise.all([
      this.prisma.complaint.count({
        where,
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          createdAt: {
            gte: todayStart,
          },
        }),
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          createdAt: {
            gte: monthStart,
          },
        }),
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          status: ComplaintStatus.OPEN,
        }),
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          status: ComplaintStatus.IN_PROGRESS,
        }),
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          status: ComplaintStatus.RESOLVED,
        }),
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          status: ComplaintStatus.REJECTED,
        }),
      }),

      this.prisma.complaint.count({
        where: this.andWhere(where, {
          priority: ComplaintPriority.HIGH,
        }),
      }),
    ]);

    return {
      totalComplaints,
      todayComplaints,
      thisMonthComplaints,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      rejectedComplaints,
      highPriorityComplaints,
    };
  }

  /**
   * Returns complaint counts grouped by status and priority.
   *
   * @param query Complaint filters.
   */
  async getComplaintsCharts(query: GetAdminComplaintsQueryDto) {
    const where = this.buildComplaintsWhere(query);

    const [complaintsByStatus, complaintsByPriority] = await Promise.all([
      this.prisma.complaint.groupBy({
        by: ['status'],
        where,
        _count: {
          status: true,
        },
        orderBy: {
          _count: {
            status: 'desc',
          },
        },
      }),

      this.prisma.complaint.groupBy({
        by: ['priority'],
        where,
        _count: {
          priority: true,
        },
        orderBy: {
          _count: {
            priority: 'desc',
          },
        },
      }),
    ]);

    return {
      complaintsByStatus: complaintsByStatus.map((item) => ({
        label: item.status,
        status: item.status,
        count: item._count.status,
      })),

      complaintsByPriority: complaintsByPriority.map((item) => ({
        label: item.priority,
        priority: item.priority,
        count: item._count.priority,
      })),
    };
  }

  /**
   * Exports filtered active complaints as CSV.
   *
   * @param query Complaint filters and sorting options.
   */
  async exportComplaintsCsv(query: GetAdminComplaintsQueryDto) {
    const where = this.buildComplaintsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['updatedAt', 'resolvedAt', 'status', 'priority', 'createdAt'] as const,
      'createdAt',
    );

    const complaints = await this.prisma.complaint.findMany({
      where,
      orderBy,
      take: AdminComplaintsService.MAX_CSV_EXPORT_ROWS,
      select: this.complaintSelect,
    });

    const headers = [
      'Complaint ID',
      'Subject',
      'Message',
      'Status',
      'Priority',
      'Admin Reply',
      'User ID',
      'User Name',
      'User Email',
      'Idea ID',
      'Idea Title',
      'Created At',
      'Updated At',
      'Resolved At',
    ];

    const rows = complaints.map((complaint) => [
      complaint.id,
      complaint.subject,
      complaint.message,
      complaint.status,
      complaint.priority,
      complaint.adminReply ?? '',
      complaint.user.id,
      complaint.user.fullName,
      complaint.user.email,
      complaint.idea?.id ?? '',
      complaint.idea?.title ?? '',
      complaint.createdAt.toISOString(),
      complaint.updatedAt.toISOString(),
      complaint.resolvedAt?.toISOString() ?? '',
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Updates one active complaint.
   *
   * Reading, updating, and audit logging occur inside one
   * transaction to reduce the possibility of recording stale
   * old values during concurrent administrator updates.
   *
   * @param complaintId Complaint identifier.
   * @param body Validated partial update.
   * @param adminId Authenticated administrator identifier.
   */
  async updateComplaint(
    complaintId: string,
    body: UpdateComplaintDto,
    adminId: string,
  ) {
    if (
      body.status === undefined &&
      body.priority === undefined &&
      body.adminReply === undefined
    ) {
      throw new BadRequestException(
        'At least one complaint field must be provided',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.findFirst({
        where: {
          id: complaintId,
          deletedAt: null,
        },
      });

      if (!complaint) {
        throw new NotFoundException('Complaint not found');
      }

      const hasChanges =
        (body.status !== undefined && body.status !== complaint.status) ||
        (body.priority !== undefined && body.priority !== complaint.priority) ||
        (body.adminReply !== undefined &&
          body.adminReply !== complaint.adminReply);

      if (!hasChanges) {
        return {
          message: 'No changes detected',
          complaint,
          updated: false as const,
          affectedUserId: complaint.userId,
        };
      }

      const updated = await tx.complaint.update({
        where: {
          id: complaint.id,
        },
        data: {
          status: body.status ?? complaint.status,
          priority: body.priority ?? complaint.priority,
          adminReply:
            body.adminReply !== undefined
              ? body.adminReply
              : complaint.adminReply,
          resolvedAt: resolveComplaintResolvedAt(
            body.status,
            complaint.status,
            complaint.resolvedAt,
          ),
        },
        select: {
          ...this.complaintSelect,
          userId: true,
        },
      });

      await this.auditService.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_UPDATE_COMPLAINT,
          targetType: AuditTargetType.COMPLAINT,
          targetId: complaint.id,
          oldValue: {
            status: complaint.status,
            priority: complaint.priority,
            adminReply: complaint.adminReply,
            resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
          },
          newValue: {
            status: updated.status,
            priority: updated.priority,
            adminReply: updated.adminReply,
            resolvedAt: updated.resolvedAt?.toISOString() ?? null,
          },
        },
        tx,
      );

      const { userId, ...safeComplaint } = updated;

      return {
        message: 'Complaint updated successfully',
        complaint: safeComplaint,
        updated: true as const,
        affectedUserId: userId,
      };
    });

    if (result.updated) {
      await this.invalidateComplaintCaches(result.affectedUserId);
    }

    const { affectedUserId, ...response } = result;

    void affectedUserId;

    return response;
  }

  /**
   * Builds the shared administrator complaint filter.
   *
   * Soft-deleted complaints are always excluded.
   *
   * @param query Complaint query options.
   */
  private buildComplaintsWhere(
    query: GetAdminComplaintsQueryDto,
  ): Prisma.ComplaintWhereInput {
    const where: Prisma.ComplaintWhereInput = {
      deletedAt: null,

      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter('status', query.status) ?? {}),

      ...(buildExactFilter('priority', query.priority) ?? {}),
    };

    const search = query.search?.trim();

    if (search) {
      where.OR = [
        {
          subject: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          message: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          adminReply: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          user: {
            is: {
              OR: [
                {
                  fullName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
        {
          idea: {
            is: {
              title: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Combines a base Prisma filter with an additional condition.
   *
   * Using AND prevents additional summary conditions from
   * overwriting status, priority, search, or date filters.
   */
  private andWhere(
    baseWhere: Prisma.ComplaintWhereInput,
    additionalWhere: Prisma.ComplaintWhereInput,
  ): Prisma.ComplaintWhereInput {
    return {
      AND: [baseWhere, additionalWhere],
    };
  }

  /**
   * Invalidates user caches affected by complaint updates.
   *
   * @param userId User whose complaint data changed.
   */
  private async invalidateComplaintCaches(userId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(userCacheKeys.summary(userId)),
      this.cacheManager.del(userCacheKeys.activity(userId)),
    ]);
  }
}
