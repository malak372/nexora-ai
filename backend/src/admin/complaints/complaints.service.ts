import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AdminAction,
  AdminTargetType,
  ComplaintPriority,
  ComplaintStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetComplaintsQueryDto } from './dto/get-complaints-query.dto';
import { UpdateComplaintDto } from './dto/update-complaint.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildRelationSearchFilter,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';
import { buildResolvedAt } from './utils/complaints.rules';

/**
 * Service responsible for Admin complaint management operations.
 *
 * Provides:
 * - Paginated complaints list.
 * - Filtering by status, priority, and date range.
 * - Search by complaint content, related user, or idea title.
 * - Safe sorting using whitelisted fields.
 * - Summary reports.
 * - Chart-ready analytics.
 * - Complaint updates with audit logging.
 *
 * @author Malak
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Builds the shared Prisma where filter for complaints.
   *
   * This keeps list, summary, and charts consistent
   * when the same filters are applied.
   */
  private buildComplaintsWhere(
    query: GetComplaintsQueryDto,
  ): Prisma.ComplaintWhereInput {
    return {
      ...buildDateFilter(query),

      ...buildSearchFilter(
        ['subject', 'message', 'adminReply'],
        query.search,
      ),

      ...buildRelationSearchFilter(
        'user',
        ['fullName', 'email'],
        query.search,
      ),

      ...buildRelationSearchFilter(
        'idea',
        ['title'],
        query.search,
      ),

      ...buildExactFilter('status', query.status),
      ...buildExactFilter('priority', query.priority),
    };
  }

  /**
   * Retrieves complaints with filtering, searching,
   * sorting, and pagination.
   *
   * Endpoint:
   * GET /admin/complaints
   */
  async getComplaints(query: GetComplaintsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildComplaintsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'updatedAt',
        'resolvedAt',
        'status',
        'priority',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const [complaints, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
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
        },
      }),

      this.prisma.complaint.count({ where }),
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
   * Retrieves complaint summary statistics.
   *
   * Endpoint:
   * GET /admin/complaints/summary
   */
  async getComplaintsSummary(query: GetComplaintsQueryDto) {
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
      this.prisma.complaint.count({ where }),

      this.prisma.complaint.count({
        where: {
          ...where,
          createdAt: {
            gte: todayStart,
          },
        },
      }),

      this.prisma.complaint.count({
        where: {
          ...where,
          createdAt: {
            gte: monthStart,
          },
        },
      }),

      this.prisma.complaint.count({
        where: {
          ...where,
          status: ComplaintStatus.OPEN,
        },
      }),

      this.prisma.complaint.count({
        where: {
          ...where,
          status: ComplaintStatus.IN_PROGRESS,
        },
      }),

      this.prisma.complaint.count({
        where: {
          ...where,
          status: ComplaintStatus.RESOLVED,
        },
      }),

      this.prisma.complaint.count({
        where: {
          ...where,
          status: ComplaintStatus.REJECTED,
        },
      }),

      this.prisma.complaint.count({
        where: {
          ...where,
          priority: ComplaintPriority.HIGH,
        },
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
   * Retrieves chart-ready analytics for complaints.
   *
   * Endpoint:
   * GET /admin/complaints/charts
   */
  async getComplaintsCharts(query: GetComplaintsQueryDto) {
    const where = this.buildComplaintsWhere(query);

    const [complaintsByStatus, complaintsByPriority] =
      await Promise.all([
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
   * Updates an existing complaint.
   *
   * If status changes to RESOLVED, resolvedAt is automatically set.
   * The update is recorded in the Admin Audit Log.
   *
   * Endpoint:
   * PATCH /admin/complaints/:id
   */
  async updateComplaint(
    id: string,
    body: UpdateComplaintDto,
    adminId: string,
  ) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }

    const hasChanges =
      (body.status !== undefined && body.status !== complaint.status) ||
      (body.priority !== undefined &&
        body.priority !== complaint.priority) ||
      (body.adminReply !== undefined &&
        body.adminReply !== complaint.adminReply);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        complaint,
        updated: false,
      };
    }

    const updatedComplaint = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: body.status ?? complaint.status,
        priority: body.priority ?? complaint.priority,
        adminReply: body.adminReply ?? complaint.adminReply,
        resolvedAt: buildResolvedAt(
          body.status,
          complaint.status,
          complaint.resolvedAt,
        ),
      },
      select: {
        id: true,
        subject: true,
        message: true,
        status: true,
        priority: true,
        adminReply: true,
        resolvedAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_UPDATE_COMPLAINT,
      targetType: AdminTargetType.COMPLAINT,
      targetId: id,
      oldValue: {
        status: complaint.status,
        priority: complaint.priority,
        adminReply: complaint.adminReply,
        resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
      },
      newValue: {
        status: updatedComplaint.status,
        priority: updatedComplaint.priority,
        adminReply: updatedComplaint.adminReply,
        resolvedAt: updatedComplaint.resolvedAt?.toISOString() ?? null,
      },
    });

    return {
      message: 'Complaint updated successfully',
      complaint: updatedComplaint,
      updated: true,
    };
  }
}