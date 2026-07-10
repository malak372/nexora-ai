import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { UserValidationService } from '../validation/validation.service';
import { CreateUserComplaintDto } from './dto/create-user-complaint.dto';
import { GetUserComplaintsQueryDto } from './dto/get-user-complaints-query.dto';
import { userCacheKeys } from '../cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for authenticated user complaint operations.
 *
 * This service implements the user-facing complaint workflow
 * in Nexora AI.
 *
 * It allows registered users to:
 * - Submit complaints to the admin team.
 * - Attach a complaint to one of their generated ideas.
 * - View their own submitted complaints.
 * - View admin replies and complaint status updates.
 *
 * Security rules:
 * - Users can only access their own complaints.
 * - Users can only link complaints to ideas they own.
 * - Admin-only complaint management is handled separately
 *   by the admin complaint module.
 *
 * Cache behavior:
 * - Creating a complaint invalidates the cached dashboard summary,
 *   because complaint counters are displayed there.
 * - Creating a complaint also invalidates the cached recent activity
 *   because the user's latest complaint becomes part of the activity feed.
 *
 * @author Eman
 */
@Injectable()
export class UserComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,
    private readonly auditService: AuditService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Creates a new complaint for the authenticated user.
   *
   * The complaint may optionally be linked to a generated idea,
   * but the idea must belong to the same authenticated user.
   *
   * Created complaints start with the default status and priority
   * defined in the Prisma schema.
   *
   * After creation, the user's cached dashboard summary is invalidated
   * so complaint counters remain accurate.
   */
  async createComplaint(userId: string, dto: CreateUserComplaintDto) {
    await this.userCommonService.findUserOrThrow(userId);

    if (dto.ideaId) {
      const idea = await this.prisma.idea.findFirst({
        where: {
          id: dto.ideaId,
          userId,
        },
        select: { id: true },
      });

      if (!idea) {
        throw new NotFoundException('Related idea not found');
      }
    }

    const complaint = await this.prisma.complaint.create({
      data: {
        userId,
        ideaId: dto.ideaId,
        subject: dto.subject,
        message: dto.message,
      },
      select: this.complaintSelect,
    });

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_CREATE_COMPLAINT,
      targetType: AuditTargetType.COMPLAINT,
      targetId: complaint.id,
      newValue: {
        subject: complaint.subject,
        ideaId: complaint.ideaId,
        status: complaint.status,
      },
    });

    await this.cacheManager.del(userCacheKeys.summary(userId));
    await this.cacheManager.del(userCacheKeys.activity(userId));

    return complaint;
  }

  /**
   * Retrieves complaints submitted by the authenticated user.
   *
   * Supports:
   * - Pagination.
   * - Search by subject, message, or admin reply.
   * - Date range filtering.
   * - Filtering by status.
   * - Filtering by priority.
   * - Sorting.
   */
  async getComplaints(userId: string, query: GetUserComplaintsQueryDto) {
    await this.userCommonService.findUserOrThrow(userId);

    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.ComplaintWhereInput = {
      userId,
      ...buildDateFilter(query),
      ...buildSearchFilter(['subject', 'message', 'adminReply'], query.search),
      ...buildExactFilter('status', query.status),
      ...buildExactFilter('priority', query.priority),
    };

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'updatedAt', 'status', 'priority'] as const,
      'createdAt',
    );

    const [complaints, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: this.complaintSelect,
      }),
      this.prisma.complaint.count({ where }),
    ]);

    return {
      data: complaints,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves a single complaint owned by the authenticated user.
   *
   * The complaint must belong to the current user.
   */
  async getComplaintById(userId: string, complaintId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const complaint = await this.prisma.complaint.findFirst({
      where: {
        id: complaintId,
        userId,
      },
      select: this.complaintSelect,
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }

    return complaint;
  }

  /**
   * Shared complaint selection used to keep user complaint
   * responses consistent across list and detail endpoints.
   */
  private readonly complaintSelect = {
    id: true,
    ideaId: true,
    subject: true,
    message: true,
    status: true,
    priority: true,
    adminReply: true,
    createdAt: true,
    updatedAt: true,
    resolvedAt: true,
    idea: {
      select: {
        id: true,
        title: true,
      },
    },
  } satisfies Prisma.ComplaintSelect;
}
