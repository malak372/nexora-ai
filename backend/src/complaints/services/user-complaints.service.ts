import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';

import type { Cache } from 'cache-manager';

import {
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

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
 * - Optionally link complaints to user-owned ideas.
 * - Retrieve the user's own complaints.
 * - Retrieve one user-owned complaint.
 * - Create audit records.
 * - Invalidate complaint-dependent user caches.
 *
 * Security rules:
 * - Every query is scoped by userId.
 * - Users cannot access complaints belonging to other users.
 * - Users cannot link complaints to ideas belonging to other users.
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
   * Shared complaint selection used by user list, detail,
   * and creation responses.
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
   * Creates a new complaint for one authenticated user.
   */
  async createComplaint(
    userId: string,
    dto: CreateUserComplaintDto,
  ) {
    await this.ensureUserExists(userId);

    if (dto.ideaId) {
      await this.ensureUserOwnsIdea(
        userId,
        dto.ideaId,
      );
    }

    const complaint = await this.prisma.$transaction(
      async (tx) => {
        const createdComplaint =
          await tx.complaint.create({
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
            },
          },
          tx,
        );

        return createdComplaint;
      },
    );

    await this.invalidateComplaintCaches(userId);

    return complaint;
  }

  /**
   * Returns complaints belonging to the authenticated user.
   */
  async getComplaints(
    userId: string,
    query: GetUserComplaintsQueryDto,
  ) {
    await this.ensureUserExists(userId);

    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

    const where: Prisma.ComplaintWhereInput = {
      userId,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(
        [
          'subject',
          'message',
          'adminReply',
        ],
        query.search,
      ) ?? {}),

      ...(buildExactFilter(
        'status',
        query.status,
      ) ?? {}),

      ...(buildExactFilter(
        'priority',
        query.priority,
      ) ?? {}),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'createdAt',
        'updatedAt',
        'status',
        'priority',
      ] as const,
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
   * Returns one complaint belonging to the authenticated user.
   */
  async getComplaintById(
    userId: string,
    complaintId: string,
  ) {
    await this.ensureUserExists(userId);

    const complaint =
      await this.prisma.complaint.findFirst({
        where: {
          id: complaintId,
          userId,
        },

        select: this.complaintSelect,
      });

    if (!complaint) {
      throw new NotFoundException(
        'Complaint not found',
      );
    }

    return complaint;
  }

  /**
   * Ensures that the authenticated user still exists.
   */
  private async ensureUserExists(
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }
  }

  /**
   * Ensures that an optionally related idea belongs to the user.
   */
  private async ensureUserOwnsIdea(
    userId: string,
    ideaId: string,
  ): Promise<void> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
      },

      select: {
        id: true,
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Related idea not found',
      );
    }
  }

  /**
   * Invalidates user caches affected by complaint creation.
   */
  private async invalidateComplaintCaches(
    userId: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheManager.del(
        userCacheKeys.summary(userId),
      ),

      this.cacheManager.del(
        userCacheKeys.activity(userId),
      ),
    ]);
  }
}