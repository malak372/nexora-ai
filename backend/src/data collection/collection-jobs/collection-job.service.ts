import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  CollectionJobStatus,
  LanguageCode,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { CollectorsFactory } from '../../collectors/collectors.factory';

import { RunCollectionDto } from '../dto/run-collection.dto';

import { GetCollectionJobsQueryDto } from './dto/get-collection-jobs-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

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

type CollectionJobWithRelations =
  Prisma.CollectionJobGetPayload<{
    include:
      typeof collectionJobInclude;
  }>;

/**
 * Service responsible for CollectionJob persistence,
 * source validation, and source-level status management.
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
   * Validates the selected active domain.
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
        'Domain not found or inactive.',
      );
    }

    return domain;
  }

  /**
   * Resolves requested DataSource.key values against:
   * - Backend collector implementations.
   * - Active database rows.
   * - isImplemented database state.
   *
   * When no keys are supplied, all active and implemented
   * backend-supported data sources are selected.
   */
  async resolveActiveImplementedDataSources(
    requestedKeys?: string[],
  ) {
    const implementedKeys = new Set(
      this.collectorsFactory
        .getImplementedSourceKeys(),
    );

    const selectedKeys =
      requestedKeys?.length
        ? [
            ...new Set(
              requestedKeys.map((key) =>
                key
                  .trim()
                  .toLowerCase(),
              ),
            ),
          ]
        : [...implementedKeys];

    if (!selectedKeys.length) {
      throw new BadRequestException(
        'No collector implementations are currently available.',
      );
    }

    const missingImplementations =
      selectedKeys.filter(
        (key) =>
          !implementedKeys.has(key),
      );

    if (
      missingImplementations.length > 0
    ) {
      throw new BadRequestException(
        `Collector implementations not found: ${missingImplementations.join(
          ', ',
        )}`,
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
          supportsPosts: true,
          supportsComments: true,
          supportsRegion: true,
          supportsLanguage: true,
        },
      });

    const foundKeys = new Set(
      dataSources.map(
        (source) => source.key,
      ),
    );

    const unavailableKeys =
      selectedKeys.filter(
        (key) => !foundKeys.has(key),
      );

    if (unavailableKeys.length > 0) {
      throw new BadRequestException(
        `Inactive, missing, or unimplemented data sources: ${unavailableKeys.join(
          ', ',
        )}`,
      );
    }

    const dataSourceByKey = new Map(
      dataSources.map((source) => [
        source.key,
        source,
      ]),
    );

    return selectedKeys.map(
      (key) => dataSourceByKey.get(key)!,
    );
  }

  /**
   * Creates a running CollectionJob and one
   * CollectionJobSource row per selected source.
   */
  async createRunningJob(
    dto: RunCollectionDto,

    dataSources: Array<{
      id: string;
      key: string;
      displayName: string;
    }>,
  ) {
    return this.prisma.collectionJob.create({
      data: {
        domainId: dto.domainId,

        language: dto.language,

        country: dto.country,
        city: dto.city,
        region: dto.region,
        radiusKm: dto.radiusKm,

        keywords: dto.keywords ?? [],

        status:
          CollectionJobStatus.RUNNING,

        startedAt: new Date(),

        sources: {
          create: dataSources.map(
            (source) => ({
              dataSourceId:
                source.id,

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
   * Returns a job or throws NotFoundException.
   */
  async findJobOrThrow(id: string) {
    const job =
      await this.prisma.collectionJob
        .findUnique({
          where: { id },

          include: {
            sources: {
              include: {
                dataSource: true,
              },
            },
          },
        });

    if (!job) {
      throw new NotFoundException(
        'Collection job was not found.',
      );
    }

    return job;
  }

  /**
   * Returns detailed job information.
   */
  async findJobDetails(id: string) {
    const job =
      await this.prisma.collectionJob
        .findUnique({
          where: { id },

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
      throw new NotFoundException(
        'Collection job was not found.',
      );
    }

    const domainKeywords =
      this.getDomainKeywordsByLanguage(
        job.domain.domainKeywords,
        job.language,
      );

    return this.mapJobResponse(
      job,
      domainKeywords,
    );
  }

  /**
   * Marks one source as running.
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
   * Marks one source as completed.
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
            totals.totalPosts,

          totalComments:
            totals.totalComments,

          completedAt: new Date(),
          failureReason: null,
        },
      });
  }

  /**
   * Marks one source as failed.
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
   * Completes the parent CollectionJob.
   */
  completeJob(
    id: string,

    totals: {
      totalPosts: number;
      totalComments: number;
    },
  ) {
    return this.prisma.collectionJob.update({
      where: { id },

      data: {
        status:
          CollectionJobStatus.COMPLETED,

        totalPosts:
          totals.totalPosts,

        totalComments:
          totals.totalComments,

        completedAt: new Date(),
        failedReason: null,
      },

      include: collectionJobInclude,
    });
  }

  /**
   * Marks the parent job as failed.
   */
  failJob(
    id: string,
    error: unknown,
  ) {
    return this.prisma.collectionJob.update({
      where: { id },

      data: {
        status:
          CollectionJobStatus.FAILED,

        failedReason:
          this.getErrorMessage(error),

        completedAt: new Date(),
      },

      include: collectionJobInclude,
    });
  }

  /**
   * Stops a running CollectionJob and its unfinished sources.
   */
  async stopJob(id: string) {
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
            where: { id },

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
   * Returns collection status counters.
   */
  async getStatus() {
    const [
      running,
      completed,
      failed,
      stopped,
    ] = await Promise.all([
      this.prisma.collectionJob.count({
        where: {
          status:
            CollectionJobStatus.RUNNING,
        },
      }),

      this.prisma.collectionJob.count({
        where: {
          status:
            CollectionJobStatus.COMPLETED,
        },
      }),

      this.prisma.collectionJob.count({
        where: {
          status:
            CollectionJobStatus.FAILED,
        },
      }),

      this.prisma.collectionJob.count({
        where: {
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
      hasRunningJobs: running > 0,
    };
  }

  /**
   * Returns paginated collection jobs.
   */
  async findJobs(
    query: GetCollectionJobsQueryDto,
  ) {
    const {
      skip,
      take,
      page,
      limit,
    } = buildPagination(query);

    const where =
      this.buildJobsWhere(query);

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
      data: data.map((job) =>
        this.mapJobResponse(job),
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
   * Builds CollectionJob filters.
   */
  private buildJobsWhere(
    query: GetCollectionJobsQueryDto,
  ): Prisma.CollectionJobWhereInput {
    const dateFilter =
      buildDateFilter(query);

    return {
      ...(query.domainId && {
        domainId: query.domainId,
      }),

      ...(query.status && {
        status: query.status,
      }),

      ...(query.country && {
        country: {
          contains: query.country,
          mode: 'insensitive',
        },
      }),

      ...(query.city && {
        city: {
          contains: query.city,
          mode: 'insensitive',
        },
      }),

      ...(query.region && {
        region: {
          contains: query.region,
          mode: 'insensitive',
        },
      }),

      ...(query.language && {
        language: query.language,
      }),

      ...(query.dataSourceKey && {
        sources: {
          some: {
            dataSource: {
              key: query.dataSourceKey
                .trim()
                .toLowerCase(),
            },
          },
        },
      }),

      ...(dateFilter ?? {}),

      ...(query.search?.trim() && {
        OR: [
          {
            country: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

          {
            city: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

          {
            region: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

          {
            domain: {
              name: {
                contains:
                  query.search,
                mode: 'insensitive',
              },
            },
          },

          {
            sources: {
              some: {
                dataSource: {
                  OR: [
                    {
                      key: {
                        contains:
                          query.search,
                        mode:
                          'insensitive',
                      },
                    },

                    {
                      displayName: {
                        contains:
                          query.search,
                        mode:
                          'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      }),
    };
  }

  /**
   * Returns unique keywords from active domains.
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

            OR:
              language ===
              LanguageCode.ANY
                ? [
                    {
                      language:
                        LanguageCode.ANY,
                    },
                  ]
                : [
                    {
                      language:
                        LanguageCode.ANY,
                    },

                    { language },
                  ],
          },

          select: {
            keyword: true,
          },
        });

    return [
      ...new Set(
        keywords.map(
          (item) => item.keyword,
        ),
      ),
    ];
  }

  /**
   * Returns configured data-source statuses.
   */
  getDataSourcesStatus() {
    return this.prisma.dataSource.findMany({
      select: {
        id: true,
        key: true,
        displayName: true,
        description: true,

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
   * Filters domain keywords by language.
   */
  private getDomainKeywordsByLanguage(
    domainKeywords: Array<{
      keyword: string;
      language: LanguageCode;
    }>,

    language: LanguageCode,
  ): string[] {
    return domainKeywords
      .filter((item) => {
        if (
          language ===
          LanguageCode.ANY
        ) {
          return true;
        }

        return (
          item.language ===
            LanguageCode.ANY ||
          item.language === language
        );
      })
      .map((item) => item.keyword);
  }

  /**
   * Maps CollectionJob to an API response.
   */
  private mapJobResponse(
    job: CollectionJobWithRelations,
    domainKeywords?: string[],
  ) {
    const keywords =
      Array.isArray(job.keywords)
        ? job.keywords
        : [];

    return {
      id: job.id,
      domainId: job.domainId,

      language: job.language,

      country: job.country,
      city: job.city,
      region: job.region,
      radiusKm: job.radiusKm,

      keywords,

      status: job.status,

      totalPosts: job.totalPosts,
      totalComments:
        job.totalComments,

      actualPostsCount:
        job._count.posts,

      durationSeconds:
        this.calculateDurationSeconds(
          job.startedAt,
          job.completedAt,
        ),

      failedReason:
        job.status ===
        CollectionJobStatus.FAILED
          ? job.failedReason
          : undefined,

      startedAt: job.startedAt,
      completedAt:
        job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,

      domain: {
        id: job.domain.id,
        name: job.domain.name,
      },

      sources: job.sources.map(
        (source) => ({
          id: source.id,

          status: source.status,

          totalPosts:
            source.totalPosts,

          totalComments:
            source.totalComments,

          startedAt:
            source.startedAt,

          completedAt:
            source.completedAt,

          failureReason:
            source.failureReason,

          dataSource:
            source.dataSource,
        }),
      ),

      sourceCount:
        job.sources.length,

      nlpStatus:
        job.nlpAnalysis
          ? 'COMPLETED'
          : 'NOT_STARTED',

      ...(domainKeywords && {
        domainKeywords,
      }),
    };
  }

  /**
   * Calculates execution duration.
   */
  private calculateDurationSeconds(
    startedAt?: Date | null,
    completedAt?: Date | null,
  ): number | null {
    if (
      !startedAt ||
      !completedAt
    ) {
      return null;
    }

    return Math.max(
      0,
      Math.round(
        (completedAt.getTime() -
          startedAt.getTime()) /
          1000,
      ),
    );
  }

  /**
   * Converts unknown errors to safe messages.
   */
  private getErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : 'Unknown collection error.';
  }
}