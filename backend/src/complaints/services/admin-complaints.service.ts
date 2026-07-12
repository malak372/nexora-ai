import {
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

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

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
 * - List complaints.
 * - Search, filter, sort, and paginate complaints.
 * - Generate summary statistics.
 * - Generate chart-ready analytics.
 * - Export complaints as CSV.
 * - Update status, priority, and administrator reply.
 * - Record complaint updates in audit logs.
 *
 * @author Malak
 */
@Injectable()
export class AdminComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns paginated complaints for administrator monitoring.
   */
  async getComplaints(
    query: GetAdminComplaintsQueryDto,
  ) {
    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

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
        take,
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
        totalPages: calculateTotalPages(
          total,
          limit,
        ),
      },
    };
  }

  /**
   * Returns complaint summary metrics.
   */
  async getComplaintsSummary(
    query: GetAdminComplaintsQueryDto,
  ) {
    const where = this.buildComplaintsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(
      where,
      todayStart,
    );

    const monthWhere = this.mergeCreatedAtGte(
      where,
      monthStart,
    );

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
        where: todayWhere,
      }),

      this.prisma.complaint.count({
        where: monthWhere,
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
   * Returns complaint counts grouped by status and priority.
   */
  async getComplaintsCharts(
    query: GetAdminComplaintsQueryDto,
  ) {
    const where = this.buildComplaintsWhere(query);

    const [
      complaintsByStatus,
      complaintsByPriority,
    ] = await Promise.all([
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
      complaintsByStatus:
        complaintsByStatus.map((item) => ({
          label: item.status,
          status: item.status,
          count: item._count.status,
        })),

      complaintsByPriority:
        complaintsByPriority.map((item) => ({
          label: item.priority,
          priority: item.priority,
          count: item._count.priority,
        })),
    };
  }

  /**
   * Exports filtered complaints as CSV.
   */
  async exportComplaintsCsv(
    query: GetAdminComplaintsQueryDto,
  ) {
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

    const complaints =
      await this.prisma.complaint.findMany({
        where,
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

    return buildCsv(
      headers,
      rows,
    );
  }

  /**
   * Updates one complaint.
   */
  async updateComplaint(
    complaintId: string,
    body: UpdateComplaintDto,
    adminId: string,
  ) {
    const complaint =
      await this.prisma.complaint.findUnique({
        where: {
          id: complaintId,
        },
      });

    if (!complaint) {
      throw new NotFoundException(
        'Complaint not found',
      );
    }

    const hasChanges =
      (body.status !== undefined &&
        body.status !== complaint.status) ||
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

    const updatedComplaint =
      await this.prisma.$transaction(
        async (tx) => {
          const updated =
            await tx.complaint.update({
              where: {
                id: complaintId,
              },

              data: {
                status:
                  body.status ?? complaint.status,

                priority:
                  body.priority ?? complaint.priority,

                adminReply:
                  body.adminReply ??
                  complaint.adminReply,

                resolvedAt:
                  resolveComplaintResolvedAt(
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

          await this.auditService.createLog(
            {
              actorId: adminId,
              action:
                AuditAction.ADMIN_UPDATE_COMPLAINT,
              targetType:
                AuditTargetType.COMPLAINT,
              targetId: complaintId,

              oldValue: {
                status: complaint.status,
                priority: complaint.priority,
                adminReply: complaint.adminReply,
                resolvedAt:
                  complaint.resolvedAt?.toISOString() ??
                  null,
              },

              newValue: {
                status: updated.status,
                priority: updated.priority,
                adminReply: updated.adminReply,
                resolvedAt:
                  updated.resolvedAt?.toISOString() ??
                  null,
              },
            },
            tx,
          );

          return updated;
        },
      );

    return {
      message: 'Complaint updated successfully',
      complaint: updatedComplaint,
      updated: true,
    };
  }

  /**
   * Builds the shared administrator complaint filter.
   */
  private buildComplaintsWhere(
    query: GetAdminComplaintsQueryDto,
  ): Prisma.ComplaintWhereInput {
    const where: Prisma.ComplaintWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter(
        'status',
        query.status,
      ) ?? {}),

      ...(buildExactFilter(
        'priority',
        query.priority,
      ) ?? {}),
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
   * Adds a minimum createdAt value while preserving
   * an existing date filter.
   */
  private mergeCreatedAtGte(
    where: Prisma.ComplaintWhereInput,
    gte: Date,
  ): Prisma.ComplaintWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' &&
      where.createdAt !== null
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
}