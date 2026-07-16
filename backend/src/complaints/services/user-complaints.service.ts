import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import type { Cache } from 'cache-manager';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import { userCacheKeys } from '../../users/cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { CreateUserComplaintDto } from '../dto/create-user-complaint.dto';
import { GetUserComplaintsQueryDto } from '../dto/get-user-complaints-query.dto';

/**
 * Handles authenticated-user complaint operations.
 *
 * Responsibilities:
 * - Create complaints.
 * - Optionally link complaints to active user-owned ideas.
 * - Retrieve the authenticated user's active complaints.
 * - Retrieve one active user-owned complaint.
 * - Create audit records.
 * - Invalidate complaint-dependent user caches.
 *
 * Security rules:
 * - Every complaint query is scoped by userId.
 * - Soft-deleted complaints are excluded.
 * - Soft-deleted or inactive users are rejected.
 * - Users cannot access complaints belonging to other users.
 * - Users cannot link complaints to ideas belonging to other users.
 * - Soft-deleted ideas cannot be linked to new complaints.
 *
 * @author Eman
 */
@Injectable()
export class UserComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Shared complaint selection used by list, detail,
   * and creation responses.
   *
   * Sensitive or internal fields that are not required by
   * the authenticated user are intentionally omitted.
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

  /**
   * Creates a new complaint for an authenticated user.
   *
   * Complaint creation and audit-log creation are performed in
   * one database transaction so they succeed or roll back together.
   *
   * @param userId Authenticated user identifier.
   * @param dto Validated complaint input.
   */
  async createComplaint(userId: string, dto: CreateUserComplaintDto) {
    await this.ensureActiveUserExists(userId);

    if (dto.ideaId) {
      await this.ensureUserOwnsActiveIdea(userId, dto.ideaId);
    }

    const complaint = await this.prisma.$transaction(async (tx) => {
      const createdComplaint = await tx.complaint.create({
        data: {
          userId,
          ideaId: dto.ideaId,
          subject: dto.subject,
          message: dto.message,
        },
        select: this.complaintSelect,
      });

      await this.auditService.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_CREATE_COMPLAINT,
          targetType: AuditTargetType.COMPLAINT,
          targetId: createdComplaint.id,
          newValue: {
            subject: createdComplaint.subject,
            ideaId: createdComplaint.ideaId,
            status: createdComplaint.status,
            priority: createdComplaint.priority,
          },
        },
        tx,
      );

      return createdComplaint;
    });

    await this.invalidateComplaintCaches(userId);

    return complaint;
  }

  /**
   * Returns active complaints belonging to the authenticated user.
   *
   * Soft-deleted complaints are excluded from both the returned
   * records and pagination totals.
   *
   * @param userId Authenticated user identifier.
   * @param query Filtering, sorting, and pagination options.
   */
  async getComplaints(userId: string, query: GetUserComplaintsQueryDto) {
    await this.ensureActiveUserExists(userId);

    const { page, limit, skip, take } = buildPagination(query);

    const where: Prisma.ComplaintWhereInput = {
      userId,
      deletedAt: null,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(
        ['subject', 'message', 'adminReply'],
        query.search,
      ) ?? {}),

      ...(buildExactFilter('status', query.status) ?? {}),

      ...(buildExactFilter('priority', query.priority) ?? {}),
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
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Returns one active complaint owned by the authenticated user.
   *
   * A generic not-found response is used for both missing and
   * unauthorized complaints to avoid leaking ownership information.
   *
   * @param userId Authenticated user identifier.
   * @param complaintId Complaint identifier.
   */
  async getComplaintById(userId: string, complaintId: string) {
    await this.ensureActiveUserExists(userId);

    const complaint = await this.prisma.complaint.findFirst({
      where: {
        id: complaintId,
        userId,
        deletedAt: null,
      },
      select: this.complaintSelect,
    });

    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }

    return complaint;
  }

  /**
   * Ensures that the authenticated user exists, is active,
   * and has not been soft-deleted.
   *
   * @param userId User identifier.
   */
  private async ensureActiveUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  /**
   * Ensures that an optionally related idea:
   * - Exists.
   * - Belongs to the authenticated user.
   * - Has not been soft-deleted.
   *
   * @param userId Authenticated user identifier.
   * @param ideaId Related idea identifier.
   */
  private async ensureUserOwnsActiveIdea(
    userId: string,
    ideaId: string,
  ): Promise<void> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!idea) {
      throw new NotFoundException('Related idea not found');
    }
  }

  /**
   * Invalidates user caches affected by complaint activity.
   *
   * @param userId User whose cached information changed.
   */
  private async invalidateComplaintCaches(userId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(userCacheKeys.summary(userId)),
      this.cacheManager.del(userCacheKeys.activity(userId)),
    ]);
  }
}
