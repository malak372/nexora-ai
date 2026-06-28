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

/**
 * Service responsible for Admin complaint management operations.
 *
 * This service allows administrators to:
 * - View submitted complaints.
 * - Filter complaints by status and priority.
 * - Paginate complaint results.
 * - Update complaint status.
 * - Update complaint priority.
 * - Add or update an administrator reply.
 * - Mark complaints as resolved.
 *
 * It also records complaint update actions in the Admin Audit Log
 * to support accountability and traceability for administrative changes.
 *
 * @author Malak
 */
@Injectable()
export class ComplaintsService {
  /**
   * Creates an instance of ComplaintsService.
   *
   * @param prisma - Prisma service used to access the database.
   * @param auditLogsService - Service used to record admin audit logs.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  /**
   * Builds the Prisma sorting configuration for complaint queries.
   *
   * Maps the requested sorting field and direction
   * from the query parameters into a Prisma-compatible
   * orderBy object.
   *
   * If no sorting field is provided, complaints are
   * sorted by creation date in descending order.
   *
   * @param query Query parameters containing the optional
   * sorting field and sorting direction.
   * @returns Prisma orderBy object used when retrieving complaints.
   *
   * @author Malak
   */
  private buildComplaintsOrderBy(query: GetComplaintsQueryDto) {
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';

    switch (query.sortBy) {
      case 'updatedAt':
        return { updatedAt: sortOrder };

      case 'resolvedAt':
        return { resolvedAt: sortOrder };

      case 'status':
        return { status: sortOrder };

      case 'priority':
        return { priority: sortOrder };

      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  /**
   * Retrieves complaints with optional filtering and pagination.
   *
   * Supported filters:
   * - Complaint status.
   * - Complaint priority.
   *
   * Pagination:
   * - page: Current page number. Default is 1.
   * - limit: Number of complaints per page. Default is 10.
   *
   * Returned complaint data includes:
   * - Complaint subject and message.
   * - Current status and priority.
   * - Admin reply.
   * - Created, updated, and resolved timestamps.
   * - Related user information.
   * - Related idea information, if available.
   *
   * Results are ordered by creation date in descending order,
   * so the newest complaints appear first.
   *
   * @param query - Query parameters used for filtering and pagination.
   * @returns Paginated complaints list with metadata.
   */
  async getComplaints(query: GetComplaintsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ComplaintWhereInput = {};

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate && {
          gte: new Date(query.fromDate),
        }),
        ...(query.toDate && {
          lte: new Date(query.toDate),
        }),
      };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.priority) {
      where.priority = query.priority;
    }

    const [complaints, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.buildComplaintsOrderBy(query),
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Updates an existing complaint.
   *
   * Administrators can update:
   * - Complaint status.
   * - Complaint priority.
   * - Administrator reply.
   *
   * If the complaint status is changed to RESOLVED,
   * the resolvedAt timestamp is set automatically.
   *
   * After updating the complaint, this method creates an
   * admin audit log record containing the old and new values.
   *
   * @param id - ID of the complaint to update.
   * @param body - DTO containing the updated complaint fields.
   * @param adminId - ID of the authenticated administrator performing the update.
   * @returns A success message and the updated complaint information.
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

    const updatedComplaint = await this.prisma.complaint.update({
      where: {
        id,
      },
      data: {
        ...(body.status !== undefined && {
          status: body.status,
        }),
        ...(body.priority !== undefined && {
          priority: body.priority,
        }),
        ...(body.adminReply !== undefined && {
          adminReply: body.adminReply,
        }),
        resolvedAt:
          body.status === ComplaintStatus.RESOLVED
            ? new Date()
            : complaint.resolvedAt,
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