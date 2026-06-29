import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AdminAction,
  AdminTargetType,
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
} from '../../utilities/base-query/builder';
import { buildResolvedAt } from './utils/complaints.rules';

/**
 * Service responsible for Admin complaint management operations.
 *
 * This service allows administrators to view, filter,
 * sort, paginate, and update submitted complaints.
 *
 * It also records complaint update actions in the
 * Admin Audit Log.
 *
 * @author Malak
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  async getComplaints(query: GetComplaintsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.ComplaintWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('status', query.status),
      ...buildExactFilter('priority', query.priority),
    };

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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Updates an existing complaint.
   *
   * Administrators can update the complaint status,
   * priority, and administrator reply.
   *
   * If the complaint status is changed to RESOLVED,
   * the resolvedAt timestamp is set automatically.
   *
   * @param id ID of the complaint to update.
   * @param body DTO containing the updated complaint fields.
   * @param adminId ID of the authenticated administrator.
   * @returns A success message and the updated complaint.
   *
   * @throws NotFoundException if the complaint does not exist.
   */
  async updateComplaint(
    id: string,
    body: UpdateComplaintDto,
    adminId: string,
  ) {
    const complaint = await this.prisma.complaint.findUnique({
      where: {
        id,
      },
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }
    const hasChanges =
      body.status !== complaint.status ||
      body.priority !== complaint.priority ||
      (body.adminReply ?? null) !== (complaint.adminReply ?? null);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        complaint,
        updated: false,
      };
    }

    const updatedComplaint = await this.prisma.complaint.update({
      where: {
        id,
      },
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
    };
  }
}