import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

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
 * Service responsible for DataSource administration,
 * availability, and collector-registry synchronization.
 *
 * Responsibilities:
 * - Create source metadata.
 * - Update source metadata.
 * - Activate and deactivate sources.
 * - Expose operational sources to registered users.
 * - Synchronize isImplemented with CollectorsFactory.
 * - Prevent activating unavailable collectors.
 * - Create administrative audit logs.
 *
 * This service does not:
 * - Run collection jobs.
 * - Call external APIs.
 * - Store API credentials.
 * - Delete historical collection data.
 *
 * @author Malak
 */
@Injectable()
export class DataSourcesService
  implements OnModuleInit
{
  constructor(
    private readonly prisma: PrismaService,

    private readonly collectorsFactory:
      CollectorsFactory,

    private readonly auditService:
      AuditService,
  ) {}

  /**
   * Synchronizes database implementation states when
   * the application module starts.
   *
   * This ensures DataSource.isImplemented reflects the
   * collectors available in the deployed backend.
   */
  async onModuleInit(): Promise<void> {
    await this.synchronizeImplementationStates();
  }

  /**
   * Creates a new data-source record.
   *
   * @param dto Data-source metadata.
   * @param adminId Administrator performing the operation.
   */
  async create(
    dto: CreateDataSourceDto,
    adminId: string,
  ) {
    const key =
      this.normalizeSourceKey(dto.key);

    const existing =
      await this.prisma.dataSource.findUnique({
        where: { key },
        select: { id: true },
      });

    if (existing) {
      throw new ConflictException(
        `A data source with key "${key}" already exists.`,
      );
    }

    const isImplemented =
      this.collectorsFactory.isImplemented(
        key,
      );

    const requestedActiveState =
      dto.isActive ?? false;

    if (
      requestedActiveState &&
      !isImplemented
    ) {
      throw new BadRequestException(
        `Data source "${key}" cannot be activated because its collector is not implemented.`,
      );
    }

    const dataSource =
      await this.prisma.dataSource.create({
        data: {
          key,

          displayName:
            dto.displayName.trim(),

          description:
            this.normalizeOptionalText(
              dto.description,
            ),

          isActive:
            requestedActiveState,

          isImplemented,

          supportsPosts:
            dto.supportsPosts ?? true,

          supportsComments:
            dto.supportsComments ?? false,

          supportsRegion:
            dto.supportsRegion ?? false,

          supportsLanguage:
            dto.supportsLanguage ?? false,

          ...(dto.configuration !==
            undefined && {
            configuration:
              dto.configuration as Prisma.InputJsonValue,
          }),
        },
      });

    await this.auditService.createLog({
      actorId: adminId,

      action:
        AuditAction.ADMIN_CREATE_DATA_SOURCE,

      targetType:
        AuditTargetType.DATA_SOURCE,

      targetId: dataSource.id,

      newValue:
        this.toAuditSnapshot(
          dataSource,
        ),
    });

    return this.mapDataSourceResponse(
      dataSource,
    );
  }

  /**
   * Returns a paginated administrative list.
   */
  async findAllForAdmin(
    query: GetDataSourcesQueryDto,
  ) {
    const {
      skip,
      take,
      page,
      limit,
    } = buildPagination(query);

    const where =
      this.buildWhere(query);

    const [data, total] =
      await Promise.all([
        this.prisma.dataSource.findMany({
          where,
          skip,
          take,

          orderBy: buildOrderBy(
            query,
            [
              'key',
              'displayName',
              'createdAt',
              'updatedAt',
            ] as const,
            'displayName',
          ),

          include: {
            _count: {
              select: {
                collectionJobSources:
                  true,
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
        this.mapDataSourceResponse(
          dataSource,
        ),
      ),

      meta: {
        page,
        limit,
        total,

        totalPages:
          calculateTotalPages(
            total,
            limit,
          ),
      },
    };
  }

  /**
   * Returns all sources that registered users may select.
   *
   * A source is available only when:
   * - isActive is true.
   * - isImplemented is true.
   * - An operational collector exists at runtime.
   */
  async findAvailable() {
    const implementedKeys =
      this.collectorsFactory
        .getImplementedSourceKeys();

    if (!implementedKeys.length) {
      return [];
    }

    const dataSources =
      await this.prisma.dataSource.findMany({
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

    return dataSources;
  }

  /**
   * Returns one data source by database identifier.
   */
  async findOneForAdmin(id: string) {
    const dataSource =
      await this.prisma.dataSource.findUnique({
        where: { id },

        include: {
          _count: {
            select: {
              collectionJobSources:
                true,
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

    return this.mapDataSourceResponse(
      dataSource,
    );
  }

  /**
   * Updates editable data-source metadata.
   */
  async update(
    id: string,
    dto: UpdateDataSourceDto,
    adminId: string,
  ) {
    const existing =
      await this.findEntityOrThrow(id);

    const updated =
      await this.prisma.dataSource.update({
        where: { id },

        data: {
          ...(dto.displayName !==
            undefined && {
            displayName:
              dto.displayName.trim(),
          }),

          ...(dto.description !==
            undefined && {
            description:
              this.normalizeOptionalText(
                dto.description,
              ),
          }),

          ...(dto.supportsPosts !==
            undefined && {
            supportsPosts:
              dto.supportsPosts,
          }),

          ...(dto.supportsComments !==
            undefined && {
            supportsComments:
              dto.supportsComments,
          }),

          ...(dto.supportsRegion !==
            undefined && {
            supportsRegion:
              dto.supportsRegion,
          }),

          ...(dto.supportsLanguage !==
            undefined && {
            supportsLanguage:
              dto.supportsLanguage,
          }),

          ...(dto.configuration !==
            undefined && {
            configuration:
              dto.configuration as Prisma.InputJsonValue,
          }),

          /*
           * Keep the database state synchronized with
           * the deployed collector registry.
           */
          isImplemented:
            this.collectorsFactory.isImplemented(
              existing.key,
            ),
        },
      });

    await this.auditService.createLog({
      actorId: adminId,

      action:
        AuditAction.ADMIN_UPDATE_DATA_SOURCE,

      targetType:
        AuditTargetType.DATA_SOURCE,

      targetId: id,

      oldValue:
        this.toAuditSnapshot(existing),

      newValue:
        this.toAuditSnapshot(updated),
    });

    return this.mapDataSourceResponse(
      updated,
    );
  }

  /**
   * Activates or deactivates a data source.
   *
   * Activation requires an operational collector.
   */
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

    if (
      dto.isActive &&
      !runtimeImplemented
    ) {
      throw new BadRequestException(
        `Data source "${existing.key}" cannot be activated because its collector is not implemented.`,
      );
    }

    if (
      existing.isActive ===
        dto.isActive &&
      existing.isImplemented ===
        runtimeImplemented
    ) {
      return this.mapDataSourceResponse(
        existing,
      );
    }

    const updated =
      await this.prisma.dataSource.update({
        where: { id },

        data: {
          isActive: dto.isActive,

          isImplemented:
            runtimeImplemented,
        },
      });

    await this.auditService.createLog({
      actorId: adminId,

      action: dto.isActive
        ? AuditAction.ADMIN_ACTIVATE_DATA_SOURCE
        : AuditAction.ADMIN_DEACTIVATE_DATA_SOURCE,

      targetType:
        AuditTargetType.DATA_SOURCE,

      targetId: id,

      oldValue:
        this.toAuditSnapshot(existing),

      newValue:
        this.toAuditSnapshot(updated),
    });

    return this.mapDataSourceResponse(
      updated,
    );
  }

  /**
   * Manually synchronizes all database implementation states.
   *
   * Useful after adding or removing a collector from the backend.
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

    let updatedCount = 0;
    let automaticallyDeactivatedCount = 0;

    await this.prisma.$transaction(
      async (transaction) => {
        for (const source of dataSources) {
          const runtimeImplemented =
            this.collectorsFactory.isImplemented(
              source.key,
            );

          const mustDeactivate =
            source.isActive &&
            !runtimeImplemented;

          if (
            source.isImplemented ===
              runtimeImplemented &&
            !mustDeactivate
          ) {
            continue;
          }

          await transaction.dataSource.update({
            where: {
              id: source.id,
            },

            data: {
              isImplemented:
                runtimeImplemented,

              ...(mustDeactivate && {
                isActive: false,
              }),
            },
          });

          updatedCount += 1;

          if (mustDeactivate) {
            automaticallyDeactivatedCount +=
              1;
          }
        }
      },
    );

    return {
      totalDataSources:
        dataSources.length,

      updatedCount,

      automaticallyDeactivatedCount,

      implementedSourceKeys:
        this.collectorsFactory
          .getImplementedSourceKeys(),

      registeredSourceKeys:
        this.collectorsFactory
          .getRegisteredSourceKeys(),
    };
  }

  /**
   * Resolves an active and implemented DataSource by key.
   *
   * Used internally by the collection pipeline.
   */
  async findAvailableByKey(
    sourceKey: string,
  ) {
    const key =
      this.normalizeSourceKey(
        sourceKey,
      );

    if (
      !this.collectorsFactory.isImplemented(
        key,
      )
    ) {
      throw new BadRequestException(
        `The "${key}" collector is not implemented.`,
      );
    }

    const dataSource =
      await this.prisma.dataSource.findUnique({
        where: { key },
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

  /**
   * Builds Prisma filters.
   */
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
          contains:
            query.key.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.isActive !==
        undefined && {
        isActive: query.isActive,
      }),

      ...(query.isImplemented !==
        undefined && {
        isImplemented:
          query.isImplemented,
      }),

      ...(query.supportsPosts !==
        undefined && {
        supportsPosts:
          query.supportsPosts,
      }),

      ...(query.supportsComments !==
        undefined && {
        supportsComments:
          query.supportsComments,
      }),

      ...(query.supportsRegion !==
        undefined && {
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

  /**
   * Returns one DataSource entity or throws.
   */
  private async findEntityOrThrow(
    id: string,
  ) {
    const dataSource =
      await this.prisma.dataSource.findUnique({
        where: { id },
      });

    if (!dataSource) {
      throw new NotFoundException(
        'Data source was not found.',
      );
    }

    return dataSource;
  }

  /**
   * Maps a DataSource into an administrative response.
   */
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

      displayName:
        dataSource.displayName,

      description:
        dataSource.description,

      isActive:
        dataSource.isActive,

      isImplemented:
        dataSource.isImplemented,

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

      createdAt:
        dataSource.createdAt,

      updatedAt:
        dataSource.updatedAt,
    };
  }

  /**
   * Produces a safe audit snapshot.
   */
  private toAuditSnapshot(
    dataSource: {
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
    },
  ): Prisma.InputJsonObject {
    return {
      id: dataSource.id,
      key: dataSource.key,

      displayName:
        dataSource.displayName,

      description:
        dataSource.description,

      isActive:
        dataSource.isActive,

      isImplemented:
        dataSource.isImplemented,

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

  /**
   * Normalizes a backend registry key.
   */
  private normalizeSourceKey(
    sourceKey: string,
  ): string {
    return sourceKey
      .trim()
      .toLowerCase();
  }

  /**
   * Normalizes optional text.
   */
  private normalizeOptionalText(
    value?: string,
  ): string | null {
    const normalized =
      value?.trim();

    return normalized || null;
  }
}