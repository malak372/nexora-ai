import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { GetPlatformsQueryDto } from './dto/get-platforms-query.dto';
import { AuditService } from '../../audit-logs/audit-logs.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin platform management operations.
 *
 * Notes:
 * - The old Comment model was removed.
 * - Platform is now related to collected data through SocialPost.
 * - Platform comment analytics are calculated through:
 *   Platform -> SocialPost -> SocialComment
 *
 * Provides:
 * - Paginated platform listing.
 * - Search by platform name.
 * - Filtering by active status and date range.
 * - Safe sorting using whitelisted fields.
 * - Platform summary reports.
 * - Chart-ready platform analytics.
 * - Platform creation.
 * - Platform update.
 * - Soft deactivation.
 * - Audit logging for admin actions.
 *
 * @author Malak
 */
@Injectable()
export class PlatformsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
  ) {}

  /**
   * Builds the shared Prisma where filter for platform list,
   * summary, and chart queries.
   */
  private buildPlatformsWhere(
    query: GetPlatformsQueryDto,
  ): Prisma.PlatformWhereInput {
    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true'
        : undefined;

    return {
      ...buildDateFilter(query),
      ...buildSearchFilter(['name'], query.search),
      ...buildExactFilter('isActive', isActive),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving existing date filters.
   */
  private mergeCreatedAtGte(
    where: Prisma.PlatformWhereInput,
    gte: Date,
  ): Prisma.PlatformWhereInput {
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
   * Counts collected social comments for a specific platform.
   */
  private countCommentsByPlatform(platformId: string) {
    return this.prisma.socialComment.count({
      where: {
        post: {
          platformId,
        },
      },
    });
  }

  /**
   * Retrieves platforms with optional searching, date filtering,
   * active status filtering, sorting, and pagination.
   *
   * Endpoint:
   * GET /admin/platforms
   */
  async getPlatforms(query: GetPlatformsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildPlatformsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['name', 'isActive', 'updatedAt', 'createdAt'] as const,
      'createdAt',
    );

    const [platforms, total] = await Promise.all([
      this.prisma.platform.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              ideas: true,
              socialPosts: true,
            },
          },
        },
      }),

      this.prisma.platform.count({ where }),
    ]);

    const data = await Promise.all(
      platforms.map(async (platform) => ({
        ...platform,
        _count: {
          ...platform._count,
          socialComments: await this.countCommentsByPlatform(platform.id),
        },
      })),
    );

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves platform summary statistics.
   *
   * Endpoint:
   * GET /admin/platforms/summary
   */
  async getPlatformsSummary(query: GetPlatformsQueryDto) {
    const where = this.buildPlatformsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalPlatforms,
      activePlatforms,
      inactivePlatforms,
      todayPlatforms,
      thisMonthPlatforms,
      platformsWithCollectedPosts,
      platformsWithCollectedComments,
      platformsWithIdeas,
    ] = await Promise.all([
      this.prisma.platform.count({ where }),

      this.prisma.platform.count({
        where: {
          ...where,
          isActive: true,
        },
      }),

      this.prisma.platform.count({
        where: {
          ...where,
          isActive: false,
        },
      }),

      this.prisma.platform.count({ where: todayWhere }),

      this.prisma.platform.count({ where: monthWhere }),

      this.prisma.platform.count({
        where: {
          ...where,
          socialPosts: {
            some: {},
          },
        },
      }),

      this.prisma.platform.count({
        where: {
          ...where,
          socialPosts: {
            some: {
              comments: {
                some: {},
              },
            },
          },
        },
      }),

      this.prisma.platform.count({
        where: {
          ...where,
          ideas: {
            some: {},
          },
        },
      }),
    ]);

    return {
      totalPlatforms,
      activePlatforms,
      inactivePlatforms,
      todayPlatforms,
      thisMonthPlatforms,
      platformsWithCollectedPosts,
      platformsWithCollectedComments,
      platformsWithIdeas,
    };
  }

  /**
   * Retrieves chart-ready platform analytics.
   *
   * Endpoint:
   * GET /admin/platforms/charts
   */
  async getPlatformsCharts(query: GetPlatformsQueryDto) {
    const where = this.buildPlatformsWhere(query);

    const [platformsByStatus, platforms, topPlatformsByIdeas] =
      await Promise.all([
        this.prisma.platform.groupBy({
          by: ['isActive'],
          where,
          _count: {
            isActive: true,
          },
          orderBy: {
            _count: {
              isActive: 'desc',
            },
          },
        }),

        this.prisma.platform.findMany({
          where,
          take: 10,
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: {
              select: {
                socialPosts: true,
              },
            },
          },
        }),

        this.prisma.platform.findMany({
          where,
          orderBy: {
            ideas: {
              _count: 'desc',
            },
          },
          take: 10,
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: {
              select: {
                ideas: true,
              },
            },
          },
        }),
      ]);

    const platformsWithCommentCounts = await Promise.all(
      platforms.map(async (platform) => ({
        ...platform,
        socialCommentsCount: await this.countCommentsByPlatform(platform.id),
      })),
    );

    const topPlatformsByComments = platformsWithCommentCounts
      .sort((a, b) => b.socialCommentsCount - a.socialCommentsCount)
      .slice(0, 10);

    return {
      platformsByStatus: platformsByStatus.map((item) => ({
        label: item.isActive ? 'ACTIVE' : 'INACTIVE',
        isActive: item.isActive,
        count: item._count.isActive,
      })),

      platformsByCollectedPosts: platforms
        .sort((a, b) => b._count.socialPosts - a._count.socialPosts)
        .map((platform) => ({
          label: platform.name,
          platformId: platform.id,
          platformName: platform.name,
          isActive: platform.isActive,
          count: platform._count.socialPosts,
        })),

      platformsByComments: topPlatformsByComments.map((platform) => ({
        label: platform.name,
        platformId: platform.id,
        platformName: platform.name,
        isActive: platform.isActive,
        count: platform.socialCommentsCount,
      })),

      platformsByIdeas: topPlatformsByIdeas.map((platform) => ({
        label: platform.name,
        platformId: platform.id,
        platformName: platform.name,
        isActive: platform.isActive,
        count: platform._count.ideas,
      })),
    };
  }

  /**
   * Creates a new platform and records the action in audit logs.
   *
   * Endpoint:
   * POST /admin/platforms
   */
  async createPlatform(body: CreatePlatformDto, adminId: string) {
    const existingPlatform = await this.prisma.platform.findUnique({
      where: {
        name: body.name,
      },
    });

    if (existingPlatform) {
      throw new ConflictException('Platform already exists');
    }

    const platform = await this.prisma.platform.create({
      data: {
        name: body.name,
        isActive: body.isActive ?? true,
      },
    });

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_PLATFORM,
      targetType: AuditTargetType.PLATFORM,
      targetId: platform.id,
      newValue: {
        id: platform.id,
        name: platform.name,
        isActive: platform.isActive,
      },
    });

    return {
      message: 'Platform created successfully',
      platform,
    };
  }

  /**
   * Updates an existing platform and records the change in audit logs.
   *
   * Endpoint:
   * PATCH /admin/platforms/:id
   */
  async updatePlatform(
    id: string,
    body: UpdatePlatformDto,
    adminId: string,
  ) {
    const platform = await this.prisma.platform.findUnique({
      where: {
        id,
      },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    if (body.name !== undefined && body.name !== platform.name) {
      const duplicatePlatform = await this.prisma.platform.findUnique({
        where: {
          name: body.name,
        },
      });

      if (duplicatePlatform) {
        throw new ConflictException('Platform name already exists');
      }
    }

    const hasChanges =
      (body.name !== undefined && body.name !== platform.name) ||
      (body.isActive !== undefined &&
        body.isActive !== platform.isActive);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        platform,
        updated: false,
      };
    }

    const updatedPlatform = await this.prisma.platform.update({
      where: {
        id,
      },
      data: {
        ...(body.name !== undefined && {
          name: body.name,
        }),
        ...(body.isActive !== undefined && {
          isActive: body.isActive,
        }),
      },
    });

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_UPDATE_PLATFORM,
      targetType: AuditTargetType.PLATFORM,
      targetId: id,
      oldValue: {
        name: platform.name,
        isActive: platform.isActive,
      },
      newValue: {
        name: updatedPlatform.name,
        isActive: updatedPlatform.isActive,
      },
    });

    return {
      message: 'Platform updated successfully',
      platform: updatedPlatform,
      updated: true,
    };
  }

  /**
   * Deactivates a platform and records the action in audit logs.
   *
   * This performs a soft deactivation by setting isActive to false.
   *
   * Endpoint:
   * DELETE /admin/platforms/:id
   */
  async deactivatePlatform(id: string, adminId: string) {
    const platform = await this.prisma.platform.findUnique({
      where: {
        id,
      },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    if (!platform.isActive) {
      return {
        message: 'Platform is already inactive',
        platform,
        updated: false,
      };
    }

    const updatedPlatform = await this.prisma.platform.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_DEACTIVATE_PLATFORM,
      targetType: AuditTargetType.PLATFORM,
      targetId: id,
      oldValue: {
        name: platform.name,
        isActive: platform.isActive,
      },
      newValue: {
        name: updatedPlatform.name,
        isActive: updatedPlatform.isActive,
      },
    });

    return {
      message: 'Platform deactivated successfully',
      platform: updatedPlatform,
      updated: true,
    };
  }
}