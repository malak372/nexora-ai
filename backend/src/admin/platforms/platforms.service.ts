import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { GetPlatformsQueryDto } from './dto/get-platforms-query.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for Admin platform management operations.
 *
 * This service allows administrators to retrieve, search,
 * filter, sort, create, update, and deactivate platforms.
 *
 * @author Malak
 */
@Injectable()
export class PlatformsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Retrieves platforms with optional searching, date filtering,
   * active status filtering, sorting, and pagination.
   *
   * @param query Query parameters used for pagination,
   * searching, filtering, and sorting platforms.
   * @returns Paginated platforms list with metadata.
   */
  async getPlatforms(query: GetPlatformsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true'
        : undefined;

    const where: Prisma.PlatformWhereInput = {
      ...buildDateFilter(query),
      ...buildSearchFilter(['name'], query.search),
      ...buildExactFilter('isActive', isActive),
    };

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
              comments: true,
            },
          },
        },
      }),
      this.prisma.platform.count({ where }),
    ]);

    return {
      data: platforms,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Creates a new platform and records the action in audit logs.
   *
   * @param body DTO containing the platform information.
   * @param adminId ID of the authenticated admin creating the platform.
   * @returns A success message and the newly created platform.
   *
   * @throws ConflictException if a platform with the same name already exists.
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
      adminId,
      action: AdminAction.ADMIN_CREATE_PLATFORM,
      targetType: AdminTargetType.PLATFORM,
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
   * @param id ID of the platform to update.
   * @param body DTO containing the updated platform information.
   * @param adminId ID of the authenticated admin updating the platform.
   * @returns A success message and the updated platform.
   *
   * @throws NotFoundException if the platform does not exist.
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
      adminId,
      action: AdminAction.ADMIN_UPDATE_PLATFORM,
      targetType: AdminTargetType.PLATFORM,
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
    };
  }

  /**
   * Deactivates a platform and records the action in audit logs.
   *
   * This operation performs a soft deactivation by setting
   * the platform's active status to false.
   *
   * @param id ID of the platform to deactivate.
   * @param adminId ID of the authenticated admin deactivating the platform.
   * @returns A success message and the updated platform.
   *
   * @throws NotFoundException if the platform does not exist.
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

    const updatedPlatform = await this.prisma.platform.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_DEACTIVATE_PLATFORM,
      targetType: AdminTargetType.PLATFORM,
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
    };
  }
}