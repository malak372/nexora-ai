import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { AuditService } from '../audit-logs/audit-logs.service';
import { CollectorsFactory } from '../collectors/collectors.factory';
import { PrismaService } from '../prisma/prisma.service';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../utilities/base-query/builder';

import { calculateTotalPages } from '../utilities/analytics/analytics.helper';

import { CreateDataSourceDto } from './dto/create-data-source.dto';
import { GetDataSourcesQueryDto } from './dto/get-data-sources-query.dto';
import { UpdateDataSourceStatusDto } from './dto/update-data-source-status.dto';
import { UpdateDataSourceDto } from './dto/update-data-source.dto';

/**
 * Service responsible for DataSource administration, availability, and
 * collector-registry safety checks.
 *
 * isImplemented is an administrator-controlled enablement flag. A source can
 * only be marked implemented when a matching runtime collector exists.
 * runtimeImplemented is always derived from CollectorsFactory and is returned
 * separately to the frontend.
 *
 * @author Eman
 */
@Injectable()
export class DataSourcesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collectorsFactory: CollectorsFactory,
    private readonly auditService: AuditService,
  ) { }

  async onModuleInit(): Promise<void> {
    await this.synchronizeImplementationStates();
  }

  async create(dto: CreateDataSourceDto, adminId: string) {
    const key = this.normalizeSourceKey(dto.key);

    const existing = await this.prisma.dataSource.findUnique({
      where: { key },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `A data source with key "${key}" already exists.`,
      );
    }

    const runtimeImplemented = this.collectorsFactory.isImplemented(key);

    const requestedImplementationState =
      dto.isImplemented ?? runtimeImplemented;

    const requestedActiveState = dto.isActive ?? false;

    this.assertOperationalState({
      key,
      runtimeImplemented,
      isImplemented: requestedImplementationState,
      isActive: requestedActiveState,
    });

    const dataSource = await this.prisma.dataSource.create({
      data: {
        key,
        displayName: dto.displayName.trim(),
        description: this.normalizeOptionalText(dto.description),
        isActive: requestedActiveState,
        isImplemented: requestedImplementationState,
        supportsPosts: dto.supportsPosts ?? true,
        supportsComments: dto.supportsComments ?? false,
        supportsRegion: dto.supportsRegion ?? false,
        supportsLanguage: dto.supportsLanguage ?? false,
        ...(dto.configuration !== undefined && {
          configuration: dto.configuration as Prisma.InputJsonValue,
        }),
      },
    });

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_DATA_SOURCE,
      targetType: AuditTargetType.DATA_SOURCE,
      targetId: dataSource.id,
      newValue: this.toAuditSnapshot(dataSource),
    });

    return this.mapDataSourceResponse(dataSource);
  }

  async findAllForAdmin(query: GetDataSourcesQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);
    const where = this.buildWhere(query);

    const [data, total] = await Promise.all([
      this.prisma.dataSource.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          query,
          ['key', 'displayName', 'createdAt', 'updatedAt'] as const,
          'displayName',
        ),
        include: {
          _count: {
            select: {
              collectionJobSources: true,
              socialPosts: true,
            },
          },
        },
      }),

      this.prisma.dataSource.count({
        where,
      }),
    ]);

    return {
      data: data.map((dataSource) =>
        this.mapDataSourceResponse(dataSource),
      ),

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  async getAdminSummary() {
    const dataSources = await this.prisma.dataSource.findMany({
      select: {
        key: true,
        isActive: true,
        isImplemented: true,
      },
    });

    let active = 0;
    let implemented = 0;
    let runtimeImplemented = 0;
    let available = 0;

    for (const source of dataSources) {
      const runtime =
        this.collectorsFactory.isImplemented(source.key);

      if (source.isActive) {
        active += 1;
      }

      if (source.isImplemented) {
        implemented += 1;
      }

      if (runtime) {
        runtimeImplemented += 1;
      }

      if (
        source.isActive &&
        source.isImplemented &&
        runtime
      ) {
        available += 1;
      }
    }

    return {
      total: dataSources.length,
      active,
      inactive: dataSources.length - active,
      implemented,
      implementationDisabled:
        dataSources.length - implemented,
      runtimeImplemented,
      available,
    };
  }

  async findAvailable() {
    const implementedKeys =
      this.collectorsFactory.getImplementedSourceKeys();

    if (!implementedKeys.length) {
      return [];
    }

    return this.prisma.dataSource.findMany({
      where: {
        isActive: true,
        isImplemented: true,
        key: {
          in: implementedKeys,
        },
      },

      select: {
        id: true,
        key: true,
        displayName: true,
        description: true,
        supportsPosts: true,
        supportsComments: true,
        supportsRegion: true,
        supportsLanguage: true,
      },

      orderBy: {
        displayName: 'asc',
      },
    });
  }

  async findOneForAdmin(id: string) {
    const dataSource =
      await this.prisma.dataSource.findUnique({
        where: {
          id,
        },

        include: {
          _count: {
            select: {
              collectionJobSources: true,
              socialPosts: true,
            },
          },
        },
      });

    if (!dataSource) {
      throw new NotFoundException(
        'Data source was not found.',
      );
    }

    return this.mapDataSourceResponse(dataSource);
  }

  async remove(id: string, adminId: string) {
    const existing = await this.prisma.dataSource.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            collectionJobSources: true,
            socialPosts: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Data source was not found.');
    }

    const collectionJobs = existing._count.collectionJobSources;
    const socialPosts = existing._count.socialPosts;

    if (collectionJobs > 0 || socialPosts > 0) {
      throw new ConflictException(
        `This data source cannot be deleted because it is referenced by ${collectionJobs} collection job${collectionJobs === 1 ? '' : 's'} and ${socialPosts} collected post${socialPosts === 1 ? '' : 's'}. Deactivate it instead to preserve historical evidence.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.auditService.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_UPDATE_DATA_SOURCE,
          targetType: AuditTargetType.DATA_SOURCE,
          targetId: id,
          oldValue: this.toAuditSnapshot(existing),
          newValue: {
            deleted: true,
            id: existing.id,
            key: existing.key,
            displayName: existing.displayName,
          },
        },
        tx,
      );

      await tx.dataSource.delete({
        where: { id },
      });
    });

    return {
      message: 'Data source deleted successfully.',
      id: existing.id,
      key: existing.key,
    };
  }

  async update(
    id: string,
    dto: UpdateDataSourceDto,
    adminId: string,
  ) {
    const existing =
      await this.findEntityOrThrow(id);

    const runtimeImplemented =
      this.collectorsFactory.isImplemented(
        existing.key,
      );

    const nextImplemented =
      dto.isImplemented ?? existing.isImplemented;

    const nextActive =
      dto.isActive ?? existing.isActive;

    this.assertOperationalState({
      key: existing.key,
      runtimeImplemented,
      isImplemented: nextImplemented,
      isActive: nextActive,
    });

    const updated =
      await this.prisma.dataSource.update({
        where: {
          id,
        },

        data: {
          ...(dto.displayName !== undefined && {
            displayName: dto.displayName.trim(),
          }),

          ...(dto.description !== undefined && {
            description:
              this.normalizeOptionalText(
                dto.description,
              ),
          }),

          ...(dto.isActive !== undefined && {
            isActive: dto.isActive,
          }),

          ...(dto.isImplemented !== undefined && {
            isImplemented: dto.isImplemented,
          }),

          ...(dto.supportsPosts !== undefined && {
            supportsPosts: dto.supportsPosts,
          }),

          ...(dto.supportsComments !== undefined && {
            supportsComments:
              dto.supportsComments,
          }),

          ...(dto.supportsRegion !== undefined && {
            supportsRegion: dto.supportsRegion,
          }),

          ...(dto.supportsLanguage !== undefined && {
            supportsLanguage:
              dto.supportsLanguage,
          }),

          ...(dto.configuration !== undefined && {
            configuration:
              dto.configuration as Prisma.InputJsonValue,
          }),
        },
      });

    await this.auditService.createLog({
      actorId: adminId,
      action:
        AuditAction.ADMIN_UPDATE_DATA_SOURCE,
      targetType: AuditTargetType.DATA_SOURCE,
      targetId: id,
      oldValue: this.toAuditSnapshot(existing),
      newValue: this.toAuditSnapshot(updated),
    });

    return this.mapDataSourceResponse(updated);
  }

  /**
   * Permanently removes a data source only when no historical collection jobs
   * or evidence posts reference it. Referenced sources must be deactivated
   * instead so existing historical data remains valid.
   *
   * @param id Data-source identifier to remove.
   */
  async remove(
    id: string,
  ) {
    const existing =
      await this.prisma.dataSource.findUnique({
        where: {
          id,
        },
        include: {
          _count: {
            select: {
              collectionJobSources: true,
              socialPosts: true,
            },
          },
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Data source was not found.',
      );
    }

    if (
      existing._count.collectionJobSources > 0 ||
      existing._count.socialPosts > 0
    ) {
      throw new ConflictException(
        'This data source cannot be deleted because historical collection jobs or evidence posts reference it. Deactivate it instead.',
      );
    }

    await this.prisma.dataSource.delete({
      where: {
        id,
      },
    });

    return {
      id,
      deleted: true,
    };
  }

  async updateStatus(
    id: string,
    dto: UpdateDataSourceStatusDto,
    adminId: string,
  ) {
    const existing =
      await this.findEntityOrThrow(id);

    const runtimeImplemented =
      this.collectorsFactory.isImplemented(
        existing.key,
      );

    this.assertOperationalState({
      key: existing.key,
      runtimeImplemented,
      isImplemented: existing.isImplemented,
      isActive: dto.isActive,
    });

    if (existing.isActive === dto.isActive) {
      return this.mapDataSourceResponse(existing);
    }

    const updated =
      await this.prisma.dataSource.update({
        where: {
          id,
        },

        data: {
          isActive: dto.isActive,
        },
      });

    await this.auditService.createLog({
      actorId: adminId,

      action: dto.isActive
        ? AuditAction.ADMIN_ACTIVATE_DATA_SOURCE
        : AuditAction.ADMIN_DEACTIVATE_DATA_SOURCE,

      targetType: AuditTargetType.DATA_SOURCE,
      targetId: id,

      oldValue: this.toAuditSnapshot(existing),
      newValue: this.toAuditSnapshot(updated),
    });

    return this.mapDataSourceResponse(updated);
  }

  /**
   * Safety synchronization with the deployed collector registry.
   *
   * This method never turns an administrator-disabled implementation back on.
   * It only forces impossible states off when a runtime collector is missing.
   */
  async synchronizeImplementationStates() {
    const dataSources =
      await this.prisma.dataSource.findMany({
        select: {
          id: true,
          key: true,
          isImplemented: true,
          isActive: true,
        },
      });

    const sourcesToDisable = dataSources.filter(
      (source) => {
        const runtimeImplemented =
          this.collectorsFactory.isImplemented(
            source.key,
          );

        return (
          !runtimeImplemented &&
          (source.isImplemented ||
            source.isActive)
        );
      },
    );

    const automaticallyDeactivatedCount =
      sourcesToDisable.filter(
        (source) => source.isActive,
      ).length;

    let updatedCount = 0;

    if (sourcesToDisable.length > 0) {
      const result =
        await this.prisma.dataSource.updateMany({
          where: {
            id: {
              in: sourcesToDisable.map(
                (source) => source.id,
              ),
            },
          },

          data: {
            isImplemented: false,
            isActive: false,
          },
        });

      updatedCount = result.count;
    }

    return {
      totalDataSources: dataSources.length,
      updatedCount,
      automaticallyDeactivatedCount,

      implementedSourceKeys:
        this.collectorsFactory.getImplementedSourceKeys(),

      registeredSourceKeys:
        this.collectorsFactory.getRegisteredSourceKeys(),
    };
  }

  async findAvailableByKey(
    sourceKey: string,
  ) {
    const key =
      this.normalizeSourceKey(sourceKey);

    if (
      !this.collectorsFactory.isImplemented(key)
    ) {
      throw new BadRequestException(
        `The "${key}" collector is not implemented.`,
      );
    }

    const dataSource =
      await this.prisma.dataSource.findUnique({
        where: {
          key,
        },
      });

    if (!dataSource) {
      throw new NotFoundException(
        `Data source "${key}" is not configured.`,
      );
    }

    if (
      !dataSource.isActive ||
      !dataSource.isImplemented
    ) {
      throw new BadRequestException(
        `Data source "${key}" is currently unavailable.`,
      );
    }

    return dataSource;
  }

  private buildWhere(
    query: GetDataSourcesQueryDto,
  ): Prisma.DataSourceWhereInput {
    const dateFilter =
      buildDateFilter(query);

    const search =
      query.search?.trim();

    return {
      ...(query.key?.trim() && {
        key: {
          contains: query.key.trim(),
          mode: 'insensitive',
        },
      }),

      ...(query.isActive !== undefined && {
        isActive: query.isActive,
      }),

      ...(query.isImplemented !== undefined && {
        isImplemented:
          query.isImplemented,
      }),

      ...(query.supportsPosts !== undefined && {
        supportsPosts:
          query.supportsPosts,
      }),

      ...(query.supportsComments !==
        undefined && {
        supportsComments:
          query.supportsComments,
      }),

      ...(query.supportsRegion !== undefined && {
        supportsRegion:
          query.supportsRegion,
      }),

      ...(query.supportsLanguage !==
        undefined && {
        supportsLanguage:
          query.supportsLanguage,
      }),

      ...(dateFilter ?? {}),

      ...(search && {
        OR: [
          {
            key: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            displayName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      }),
    };
  }

  private async findEntityOrThrow(
    id: string,
  ) {
    const dataSource =
      await this.prisma.dataSource.findUnique({
        where: {
          id,
        },
      });

    if (!dataSource) {
      throw new NotFoundException(
        'Data source was not found.',
      );
    }

    return dataSource;
  }

  private assertOperationalState(input: {
    key: string;
    runtimeImplemented: boolean;
    isImplemented: boolean;
    isActive: boolean;
  }) {
    if (
      input.isImplemented &&
      !input.runtimeImplemented
    ) {
      throw new BadRequestException(
        `Data source "${input.key}" cannot be marked implemented because no deployed collector is registered for that key.`,
      );
    }

    if (
      input.isActive &&
      !input.isImplemented
    ) {
      throw new BadRequestException(
        `Data source "${input.key}" cannot be activated while its implementation switch is disabled.`,
      );
    }

    if (
      input.isActive &&
      !input.runtimeImplemented
    ) {
      throw new BadRequestException(
        `Data source "${input.key}" cannot be activated because its runtime collector is unavailable.`,
      );
    }
  }

  private mapDataSourceResponse<
    T extends {
      id: string;
      key: string;
      displayName: string;
      description: string | null;
      isActive: boolean;
      isImplemented: boolean;
      supportsPosts: boolean;
      supportsComments: boolean;
      supportsRegion: boolean;
      supportsLanguage: boolean;
      configuration: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;

      _count?: {
        collectionJobSources: number;
        socialPosts: number;
      };
    },
  >(dataSource: T) {
    const runtimeImplemented =
      this.collectorsFactory.isImplemented(
        dataSource.key,
      );

    return {
      id: dataSource.id,
      key: dataSource.key,
      displayName: dataSource.displayName,
      description: dataSource.description,
      isActive: dataSource.isActive,
      isImplemented: dataSource.isImplemented,
      runtimeImplemented,

      isAvailable:
        dataSource.isActive &&
        dataSource.isImplemented &&
        runtimeImplemented,

      supportsPosts:
        dataSource.supportsPosts,

      supportsComments:
        dataSource.supportsComments,

      supportsRegion:
        dataSource.supportsRegion,

      supportsLanguage:
        dataSource.supportsLanguage,

      configuration:
        dataSource.configuration,

      usage: {
        collectionJobs:
          dataSource._count
            ?.collectionJobSources ?? 0,

        socialPosts:
          dataSource._count
            ?.socialPosts ?? 0,
      },

      createdAt: dataSource.createdAt,
      updatedAt: dataSource.updatedAt,
    };
  }

  private toAuditSnapshot(dataSource: {
    id: string;
    key: string;
    displayName: string;
    description: string | null;
    isActive: boolean;
    isImplemented: boolean;
    supportsPosts: boolean;
    supportsComments: boolean;
    supportsRegion: boolean;
    supportsLanguage: boolean;
    configuration: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): Prisma.InputJsonObject {
    return {
      id: dataSource.id,
      key: dataSource.key,
      displayName: dataSource.displayName,
      description: dataSource.description,
      isActive: dataSource.isActive,
      isImplemented: dataSource.isImplemented,
      supportsPosts:
        dataSource.supportsPosts,
      supportsComments:
        dataSource.supportsComments,
      supportsRegion:
        dataSource.supportsRegion,
      supportsLanguage:
        dataSource.supportsLanguage,
      configuration:
        dataSource.configuration,
      createdAt:
        dataSource.createdAt.toISOString(),
      updatedAt:
        dataSource.updatedAt.toISOString(),
    };
  }

  private normalizeSourceKey(
    sourceKey: string,
  ): string {
    return sourceKey
      .trim()
      .toLowerCase();
  }

  private normalizeOptionalText(
    value?: string,
  ): string | null {
    const normalized = value?.trim();

    return normalized || null;
  }
}