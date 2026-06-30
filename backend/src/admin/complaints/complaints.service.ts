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
 * Service responsible for managing user complaints in the admin panel.
 *
 * This service provides:
 * - Listing complaints with pagination, filtering, searching, and sorting.
 * - Generating complaints summary statistics.
 * - Generating complaints chart data.
 * - Updating complaint status, priority, and admin reply.
 * - Logging admin complaint updates in audit logs.
 *
 * Used by:
 * - Admin complaints controller.
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
   * Builds the Prisma where filter used for complaints queries.
   *
   * Supports:
   * - Date filtering using fromDate and toDate.
   * - Search by complaint subject, message, and admin reply.
   * - Search by related user full name and email.
   * - Search by related idea title.
   * - Exact filtering by complaint status.
   * - Exact filtering by complaint priority.
   *
   * @param query Query parameters received from the request.
   * @returns Prisma complaint where input.
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

      ...buildRelationSearchFilter('idea', ['title'], query.search),

      ...buildExactFilter('status', query.status),
      ...buildExactFilter('priority', query.priority),
    };
  }

  /**
   * Merges a minimum createdAt date into an existing complaint where filter.
   *
   * This helper is used to calculate:
   * - Complaints created today.
   * - Complaints created this month.
   *
   * It keeps any existing createdAt filters and adds or overrides the gte value.
   *
   * @param where Existing Prisma complaint where input.
   * @param gte Minimum createdAt date.
   * @returns Updated Prisma complaint where input.
   */
  private mergeCreatedAtGte(
    where: Prisma.ComplaintWhereInput,
    gte: Date,
  ): Prisma.ComplaintWhereInput {
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
   * Retrieves complaints for the admin panel.
   *
   * Supports:
   * - Pagination.
   * - Sorting.
   * - Date filtering.
   * - Search.
   * - Status filtering.
   * - Priority filtering.
   *
   * Returned data includes:
   * - Complaint basic information.
   * - Related user information.
   * - Related idea information.
   * - Pagination metadata.
   *
   * @param query Query parameters for filtering, sorting, and pagination.
   * @returns Paginated list of complaints with metadata.
   */
  async getComplaints(query: GetComplaintsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
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
   * Retrieves summary statistics for complaints.
   *
   * Summary includes:
   * - Total complaints.
   * - Complaints created today.
   * - Complaints created this month.
   * - Open complaints.
   * - In-progress complaints.
   * - Resolved complaints.
   * - Rejected complaints.
   * - High-priority complaints.
   *
   * The same filters and search options from the query are applied.
   *
   * @param query Query parameters used to filter the summary.
   * @returns Complaint summary statistics.
   */
  async getComplaintsSummary(query: GetComplaintsQueryDto) {
    const where = this.buildComplaintsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

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
      this.prisma.complaint.count({ where: todayWhere }),
      this.prisma.complaint.count({ where: monthWhere }),

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
   * Retrieves chart-ready complaints statistics.
   *
   * Chart data includes:
   * - Complaints grouped by status.
   * - Complaints grouped by priority.
   *
   * The same filters and search options from the query are applied.
   *
   * @param query Query parameters used to filter chart data.
   * @returns Complaint chart data grouped by status and priority.
   */
  async getComplaintsCharts(query: GetComplaintsQueryDto) {
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
   * Updates a complaint by admin.
   *
   * Allows updating:
   * - Complaint status.
   * - Complaint priority.
   * - Admin reply.
   *
   * If the complaint status changes to a resolved state,
   * the resolvedAt value is calculated using complaint rules.
   *
   * If no actual changes are detected, the complaint is returned without update.
   *
   * After a successful update, an audit log is created to track:
   * - Admin ID.
   * - Action type.
   * - Target complaint ID.
   * - Old values.
   * - New values.
   *
   * @param id Complaint ID.
   * @param body Update complaint DTO.
   * @param adminId ID of the admin performing the update.
   * @throws NotFoundException If the complaint does not exist.
   * @returns Updated complaint response.
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