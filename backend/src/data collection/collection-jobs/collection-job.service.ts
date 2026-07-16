import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  CollectionJobStatus,
  LanguageCode,
  Prisma,
  UserRole,
} from '@prisma/client';

import { CollectorsFactory } from '../../collectors/collectors.factory';
import { PrismaService } from '../../prisma/prisma.service';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { RunCollectionDto } from '../dto/run-collection.dto';

import { CollectionAccessContext } from '../types/collection-access-context.type';

import { GetCollectionJobsQueryDto } from './dto/get-collection-jobs-query.dto';

/**
 * Relations returned with collection jobs.
 *
 * `satisfies Prisma.CollectionJobInclude` verifies at compile time
 * that this object remains compatible with the Prisma schema.
 */
const collectionJobInclude = {
  domain: {
    select: {
      id: true,
      name: true,
    },
  },

  sources: {
    include: {
      dataSource: {
        select: {
          id: true,
          key: true,
          displayName: true,
          isActive: true,
          isImplemented: true,
        },
      },
    },
  },

  nlpAnalysis: true,

  _count: {
    select: {
      posts: true,
    },
  },
} satisfies Prisma.CollectionJobInclude;

/**
 * Persistent data-source identity resolved for
 * one collection run.
 */
export type ResolvedCollectionDataSource = {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
};

/**
 * Service responsible for:
 * - CollectionJob persistence.
 * - CollectionJob ownership enforcement.
 * - Data-source validation.
 * - Source-level execution-state transitions.
 * - Collection-job filtering and pagination.
 *
 * @author Malak
 */
@Injectable()
export class CollectionJobService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly collectorsFactory:
      CollectorsFactory,
  ) {}

  /**
   * Validates that the selected domain exists
   * and is currently active.
   *
   * @param domainId Selected domain identifier.
   * @returns The active domain and its keywords.
   */
  async validateActiveDomain(
    domainId: string,
  ) {
    const domain =
      await this.prisma.domain.findFirst({
        where: {
          id: domainId,
          isActive: true,
        },

        include: {
          domainKeywords: true,
        },
      });

    if (!domain) {
      throw new NotFoundException(
        'Domain was not found or is inactive.',
      );
    }

    return domain;
  }

  /**
   * Resolves requested DataSource.key values against:
   * - Runtime collector implementations.
   * - Active DataSource database records.
   * - DataSource.isImplemented state.
   *
   * When no source keys are supplied, every active and
   * implemented runtime collector is selected.
   *
   * @param requestedKeys Optional DataSource.key values.
   * @returns Ordered active and implemented data sources.
   */
  async resolveActiveImplementedDataSources(
    requestedKeys?: string[],
  ): Promise<
    ResolvedCollectionDataSource[]
  > {
    const runtimeKeys = new Set(
      this.collectorsFactory
        .getImplementedSourceKeys(),
    );

    const selectedKeys = [
      ...new Set(
        (
          requestedKeys?.length
            ? requestedKeys
            : [...runtimeKeys]
        )
          .map((key) =>
            key.trim().toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];

    if (!selectedKeys.length) {
      throw new BadRequestException(
        'No collector implementations are currently available.',
      );
    }

    const missingRuntimeImplementations =
      selectedKeys.filter(
        (key) => !runtimeKeys.has(key),
      );

    if (
      missingRuntimeImplementations.length
    ) {
      throw new BadRequestException(
        `Collector implementations not found: ${missingRuntimeImplementations.join(
          ', ',
        )}.`,
      );
    }

    const dataSources =
      await this.prisma.dataSource.findMany({
        where: {
          key: {
            in: selectedKeys,
          },

          isActive: true,
          isImplemented: true,
        },

        select: {
          id: true,
          key: true,
          displayName: true,
        },
      });

    const sourceByKey = new Map(
      dataSources.map((source) => [
        source.key,
        source,
      ]),
    );

    const unavailableKeys =
      selectedKeys.filter(
        (key) => !sourceByKey.has(key),
      );

    if (unavailableKeys.length) {
      throw new BadRequestException(
        `Inactive, missing, or unimplemented data sources: ${unavailableKeys.join(
          ', ',
        )}.`,
      );
    }

    /*
     * Reconstruct the array according to the requested order.
     */
    return selectedKeys.map(
      (key) => sourceByKey.get(key)!,
    );
  }

  /**
   * Creates a running collection job and one pending
   * CollectionJobSource for each selected data source.
   *
   * createdById links the job directly to the authenticated
   * user who initiated it.
   *
   * @param dto Collection configuration.
   * @param dataSources Resolved data sources.
   * @param createdById User who owns the job.
   */
  createRunningJob(
    dto:
      | RunCollectionDto
      | {
          domainId: string;
          language: LanguageCode;
          country?: string;
          city?: string;
          region?: string;
          radiusKm?: number;
          keywords?: string[];
        },

    dataSources:
      ResolvedCollectionDataSource[],

    createdById?: string,
  ) {
    return this.prisma.collectionJob.create({
      data: {
        createdById,

        domainId: dto.domainId,
        language: dto.language,

        country:
          this.normalizeOptionalText(
            dto.country,
          ),

        city:
          this.normalizeOptionalText(
            dto.city,
          ),

        region:
          this.normalizeOptionalText(
            dto.region,
          ),

        radiusKm: dto.radiusKm,

        keywords:
          this.normalizeStringArray(
            dto.keywords,
          ),

        status:
          CollectionJobStatus.RUNNING,

        startedAt: new Date(),

        sources: {
          create: dataSources.map(
            (source) => ({
              dataSourceId: source.id,

              status:
                CollectionJobStatus.PENDING,
            }),
          ),
        },
      },

      include: collectionJobInclude,
    });
  }

  /**
   * Finds a collection job for internal pipeline operations.
   *
   * This method intentionally does not enforce ownership because
   * it is used internally while executing and stopping jobs.
   */
  async findJobOrThrow(
    id: string,
  ) {
    const job =
      await this.prisma.collectionJob
        .findUnique({
          where: {
            id,
          },

          include:
            collectionJobInclude,
        });

    if (!job) {
      throw new NotFoundException(
        'Collection job was not found.',
      );
    }

    return job;
  }

  /**
   * Returns detailed collection-job information after
   * enforcing caller ownership.
   *
   * Admin:
   * - May access any job.
   *
   * User:
   * - May access only a job where createdById equals userId.
   */
  async findJobDetails(
    id: string,
    access: CollectionAccessContext,
  ) {
    const job =
      await this.prisma.collectionJob
        .findFirst({
          where: {
            id,

            ...(access.role !==
              UserRole.ADMIN && {
              createdById:
                access.userId,
            }),
          },

          include: {
            ...collectionJobInclude,

            domain: {
              select: {
                id: true,
                name: true,

                domainKeywords: {
                  select: {
                    id: true,
                    keyword: true,
                    language: true,
                  },
                },
              },
            },
          },
        });

    if (!job) {
      /*
       * Return 404 instead of 403 to avoid revealing that
       * another user's job identifier exists.
       */
      throw new NotFoundException(
        'Collection job was not found.',
      );
    }

    const domainKeywords =
      this.getDomainKeywordsByLanguage(
        job.domain.domainKeywords,
        job.language,
      );

    return {
      ...job,
      domainKeywords,
    };
  }

  /**
   * Marks one source execution as running.
   */
  markSourceRunning(
    collectionJobId: string,
    dataSourceId: string,
  ) {
    return this.prisma
      .collectionJobSource.update({
        where: {
          collectionJobId_dataSourceId:
            {
              collectionJobId,
              dataSourceId,
            },
        },

        data: {
          status:
            CollectionJobStatus.RUNNING,

          startedAt: new Date(),
          completedAt: null,
          failureReason: null,
        },
      });
  }

  /**
   * Marks one source execution as completed.
   */
  markSourceCompleted(
    collectionJobId: string,
    dataSourceId: string,

    totals: {
      totalPosts: number;
      totalComments: number;
    },
  ) {
    return this.prisma
      .collectionJobSource.update({
        where: {
          collectionJobId_dataSourceId:
            {
              collectionJobId,
              dataSourceId,
            },
        },

        data: {
          status:
            CollectionJobStatus.COMPLETED,

          totalPosts:
            this.toNonNegativeInteger(
              totals.totalPosts,
            ),

          totalComments:
            this.toNonNegativeInteger(
              totals.totalComments,
            ),

          completedAt: new Date(),
          failureReason: null,
        },
      });
  }

  /**
   * Marks one source execution as failed.
   */
  markSourceFailed(
    collectionJobId: string,
    dataSourceId: string,
    error: unknown,
  ) {
    return this.prisma
      .collectionJobSource.update({
        where: {
          collectionJobId_dataSourceId:
            {
              collectionJobId,
              dataSourceId,
            },
        },

        data: {
          status:
            CollectionJobStatus.FAILED,

          completedAt: new Date(),

          failureReason:
            this.getErrorMessage(error),
        },
      });
  }

  /**
   * Marks every unfinished source as stopped.
   *
   * Used when an administrator stops the parent job while
   * the pipeline is processing source executions.
   */
  markRemainingSourcesStopped(
    collectionJobId: string,
  ) {
    return this.prisma
      .collectionJobSource.updateMany({
        where: {
          collectionJobId,

          status: {
            in: [
              CollectionJobStatus.PENDING,
              CollectionJobStatus.RUNNING,
            ],
          },
        },

        data: {
          status:
            CollectionJobStatus.STOPPED,

          completedAt: new Date(),
        },
      });
  }

  /**
   * Completes the parent collection job.
   */
  completeJob(
    id: string,

    totals: {
      totalPosts: number;
      totalComments: number;
    },
  ) {
    return this.prisma.collectionJob.update({
      where: {
        id,
      },

      data: {
        status:
          CollectionJobStatus.COMPLETED,

        totalPosts:
          this.toNonNegativeInteger(
            totals.totalPosts,
          ),

        totalComments:
          this.toNonNegativeInteger(
            totals.totalComments,
          ),

        completedAt: new Date(),
        failedReason: null,
      },

      include:
        collectionJobInclude,
    });
  }

  /**
   * Marks the parent collection job as failed.
   */
  failJob(
    id: string,
    error: unknown,
  ) {
    return this.prisma.collectionJob.update({
      where: {
        id,
      },

      data: {
        status:
          CollectionJobStatus.FAILED,

        failedReason:
          this.getErrorMessage(error),

        completedAt: new Date(),
      },

      include:
        collectionJobInclude,
    });
  }

  /**
   * Stops a running collection job and every unfinished
   * source execution atomically.
   */
  async stopJob(
    id: string,
  ) {
    const job =
      await this.findJobOrThrow(id);

    if (
      job.status !==
      CollectionJobStatus.RUNNING
    ) {
      throw new BadRequestException(
        'Only running collection jobs can be stopped.',
      );
    }

    const completedAt = new Date();

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction
          .collectionJobSource.updateMany({
            where: {
              collectionJobId: id,

              status: {
                in: [
                  CollectionJobStatus.PENDING,
                  CollectionJobStatus.RUNNING,
                ],
              },
            },

            data: {
              status:
                CollectionJobStatus.STOPPED,

              completedAt,
            },
          });

        return transaction
          .collectionJob.update({
            where: {
              id,
            },

            data: {
              status:
                CollectionJobStatus.STOPPED,

              completedAt,
            },

            include:
              collectionJobInclude,
          });
      },
    );
  }

  /**
   * Returns collection-job counters visible
   * to the current caller.
   */
  async getStatus(
    access: CollectionAccessContext,
  ) {
    const ownershipWhere:
      Prisma.CollectionJobWhereInput =
        access.role === UserRole.ADMIN
          ? {}
          : {
              createdById:
                access.userId,
            };

    const [
      running,
      completed,
      failed,
      stopped,
    ] = await Promise.all([
      this.prisma.collectionJob.count({
        where: {
          ...ownershipWhere,

          status:
            CollectionJobStatus.RUNNING,
        },
      }),

      this.prisma.collectionJob.count({
        where: {
          ...ownershipWhere,

          status:
            CollectionJobStatus.COMPLETED,
        },
      }),

      this.prisma.collectionJob.count({
        where: {
          ...ownershipWhere,

          status:
            CollectionJobStatus.FAILED,
        },
      }),

      this.prisma.collectionJob.count({
        where: {
          ...ownershipWhere,

          status:
            CollectionJobStatus.STOPPED,
        },
      }),
    ]);

    return {
      running,
      completed,
      failed,
      stopped,
      hasRunningJobs:
        running > 0,
    };
  }

  /**
   * Returns paginated collection jobs visible
   * to the current caller.
   */
  async findJobs(
    query: GetCollectionJobsQueryDto,
    access: CollectionAccessContext,
  ) {
    const {
      skip,
      take,
      page,
      limit,
    } = buildPagination(query);

    const where =
      this.buildJobsWhere(
        query,
        access,
      );

    const [data, total] =
      await Promise.all([
        this.prisma.collectionJob
          .findMany({
            where,
            skip,
            take,

            orderBy: buildOrderBy(
              query,
              [
                'createdAt',
                'updatedAt',
                'startedAt',
                'completedAt',
                'totalPosts',
                'totalComments',
              ] as const,
              'createdAt',
            ),

            include:
              collectionJobInclude,
          }),

        this.prisma.collectionJob.count({
          where,
        }),
      ]);

    return {
      data,

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
   * Returns all active-domain keywords compatible
   * with the requested language.
   */
  async getAllActiveDomainKeywords(
    language: LanguageCode,
  ): Promise<string[]> {
    const keywords =
      await this.prisma.domainKeyword
        .findMany({
          where: {
            domain: {
              isActive: true,
            },

            ...(language !==
              LanguageCode.ANY && {
              language: {
                in: [
                  LanguageCode.ANY,
                  language,
                ],
              },
            }),
          },

          select: {
            keyword: true,
          },
        });

    return [
      ...new Set(
        keywords
          .map((item) =>
            item.keyword.trim(),
          )
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Returns current database data-source status.
   */
  getDataSourcesStatus() {
    return this.prisma.dataSource
      .findMany({
        select: {
          id: true,
          key: true,
          displayName: true,
          isActive: true,
          isImplemented: true,
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

  /**
   * Builds collection-job Prisma filters including
   * caller ownership.
   */
  private buildJobsWhere(
    query: GetCollectionJobsQueryDto,
    access: CollectionAccessContext,
  ): Prisma.CollectionJobWhereInput {
    const dateFilter =
      buildDateFilter(query);

    const search =
      query.search?.trim();

    return {
      ...(access.role !==
        UserRole.ADMIN && {
        createdById:
          access.userId,
      }),

      ...(query.domainId && {
        domainId:
          query.domainId,
      }),

      ...(query.status && {
        status:
          query.status,
      }),

      ...(query.country && {
        country: {
          contains:
            query.country.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.city && {
        city: {
          contains:
            query.city.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.region && {
        region: {
          contains:
            query.region.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.language && {
        language:
          query.language,
      }),

      ...(query.dataSourceKey && {
        sources: {
          some: {
            dataSource: {
              key:
                query.dataSourceKey
                  .trim()
                  .toLowerCase(),
            },
          },
        },
      }),

      ...(dateFilter ?? {}),

      ...(search && {
        OR: [
          {
            country: {
              contains: search,
              mode: 'insensitive',
            },
          },

          {
            city: {
              contains: search,
              mode: 'insensitive',
            },
          },

          {
            region: {
              contains: search,
              mode: 'insensitive',
            },
          },

          {
            domain: {
              name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },

          {
            sources: {
              some: {
                dataSource: {
                  displayName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            },
          },
        ],
      }),
    };
  }

  /**
   * Returns domain keywords compatible with
   * the requested collection language.
   */
  private getDomainKeywordsByLanguage(
    keywords: Array<{
      keyword: string;
      language: LanguageCode;
    }>,
    language: LanguageCode,
  ): string[] {
    return keywords
      .filter(
        (item) =>
          language ===
            LanguageCode.ANY ||
          item.language ===
            LanguageCode.ANY ||
          item.language === language,
      )
      .map((item) =>
        item.keyword.trim(),
      )
      .filter(Boolean);
  }

  /**
   * Normalizes optional strings for nullable fields.
   */
  private normalizeOptionalText(
    value?: string | null,
  ): string | undefined {
    const normalized =
      value?.trim();

    return normalized
      ? normalized
      : undefined;
  }

  /**
   * Normalizes an optional string array.
   */
  private normalizeStringArray(
    values?: string[],
  ): string[] {
    return [
      ...new Set(
        (values ?? [])
          .map((value) =>
            value.trim(),
          )
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Converts a value into a safe non-negative integer.
   */
  private toNonNegativeInteger(
    value: number,
  ): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(
      0,
      Math.trunc(value),
    );
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(
    error: unknown,
  ): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string'
      ? error
      : 'Unknown collection error.';
  }
}