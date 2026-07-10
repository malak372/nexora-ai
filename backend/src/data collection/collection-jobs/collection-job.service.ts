import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CollectionJobStatus,
  CollectionSourceType,
  LanguageCode,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RunCollectionDto } from '../dto/run-collection.dto';
import { GetCollectionJobsQueryDto } from './dto/get-collection-jobs-query.dto';
import { CollectorsFactory } from '../../collectors/collectors.factory';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';
import { PLATFORM_NAMES } from '../../collectors/base/platform-name.constant';

type CollectionJobWithRelations = Prisma.CollectionJobGetPayload<{
  include: {
    domain: {
      select: {
        id: true;
        name: true;
      };
    };
    nlpAnalysis: true;
    _count: {
      select: {
        posts: true;
      };
    };
  };
}>;

type CollectionJobResponseInput = CollectionJobWithRelations & {
  domainKeywords?: string[];
  userKeywords?: Prisma.JsonValue | null;
};

/**
 * Service responsible for collection job persistence and status management.
 *
 * @author Malak
 */
@Injectable()
export class CollectionJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collectorsFactory: CollectorsFactory,
  ) {}

  async validateActiveDomain(domainId: string) {
    const domain = await this.prisma.domain.findFirst({
      where: {
        id: domainId,
        isActive: true,
      },
      include: {
        domainKeywords: true,
      },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found or inactive.');
    }

    return domain;
  }

  validateSupportedPlatforms(platforms: CollectionSourceType[]): void {
    const supportedPlatforms = this.collectorsFactory.getSupportedPlatforms();

    const unsupportedPlatforms = platforms.filter(
      (platform) => !supportedPlatforms.includes(platform),
    );

    if (unsupportedPlatforms.length > 0) {
      throw new BadRequestException(
        `Unsupported collection platforms: ${unsupportedPlatforms.join(', ')}`,
      );
    }
  }

  async validateActivePlatform(sourceType: CollectionSourceType) {
    const platformName = PLATFORM_NAMES[sourceType];

    const platform = await this.prisma.platform.findFirst({
      where: {
        name: platformName,
        isActive: true,
      },
    });

    if (!platform) {
      throw new BadRequestException(
        `Platform ${platformName} is inactive or not found.`,
      );
    }

    return platform;
  }

  async getActiveSupportedPlatforms(): Promise<CollectionSourceType[]> {
    const supportedPlatforms = this.collectorsFactory.getSupportedPlatforms();

    const activePlatforms = await this.prisma.platform.findMany({
      where: {
        isActive: true,
        name: {
          in: supportedPlatforms.map(
            (sourceType) => PLATFORM_NAMES[sourceType],
          ),
        },
      },
      select: {
        name: true,
      },
    });

    const activePlatformNames = new Set(
      activePlatforms.map((platform) => platform.name),
    );

    return supportedPlatforms.filter((sourceType) =>
      activePlatformNames.has(PLATFORM_NAMES[sourceType]),
    );
  }

  createRunningJob(
    dto: Omit<RunCollectionDto, 'platforms'> & {
      platforms?: CollectionSourceType[];
    },
    platforms: CollectionSourceType[],
  ) {
    return this.prisma.collectionJob.create({
      data: {
        domainId: dto.domainId,
        platforms,
        language: dto.language,
        country: dto.country,
        city: dto.city,
        region: dto.region,
        radiusKm: dto.radiusKm,
        keywords: dto.keywords ?? [],
        status: CollectionJobStatus.RUNNING,
        startedAt: new Date(),
      },
    });
  }

  async findJobOrThrow(id: string) {
    const job = await this.prisma.collectionJob.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException('Collection job was not found.');
    }

    return job;
  }

  async findJobDetails(id: string) {
    const job = await this.prisma.collectionJob.findUnique({
      where: { id },
      include: {
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
        nlpAnalysis: true,
        _count: {
          select: {
            posts: true,
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Collection job was not found.');
    }

    const domainKeywords = this.getDomainKeywordsByLanguage(
      job.domain.domainKeywords,
      job.language,
    );

    return this.mapJobResponse({
      ...job,
      domainKeywords,
      userKeywords: job.keywords,
    });
  }

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
        status: CollectionJobStatus.COMPLETED,
        totalPosts: totals.totalPosts,
        totalComments: totals.totalComments,
        completedAt: new Date(),
      },
      include: {
        domain: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  failJob(id: string, error: unknown) {
    return this.prisma.collectionJob.update({
      where: { id },
      data: {
        status: CollectionJobStatus.FAILED,
        failedReason:
          error instanceof Error ? error.message : 'Unknown collection error.',
        completedAt: new Date(),
      },
    });
  }

  async stopJob(id: string) {
    const job = await this.findJobOrThrow(id);

    if (job.status !== CollectionJobStatus.RUNNING) {
      throw new BadRequestException(
        'Only running collection jobs can be stopped.',
      );
    }

    return this.prisma.collectionJob.update({
      where: { id },
      data: {
        status: CollectionJobStatus.STOPPED,
        completedAt: new Date(),
      },
    });
  }

  async getStatus() {
    const [running, completed, failed, stopped] = await Promise.all([
      this.prisma.collectionJob.count({
        where: { status: CollectionJobStatus.RUNNING },
      }),
      this.prisma.collectionJob.count({
        where: { status: CollectionJobStatus.COMPLETED },
      }),
      this.prisma.collectionJob.count({
        where: { status: CollectionJobStatus.FAILED },
      }),
      this.prisma.collectionJob.count({
        where: { status: CollectionJobStatus.STOPPED },
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

  async findJobs(query: GetCollectionJobsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);

    const where = this.buildJobsWhere(query);

    const [data, total] = await Promise.all([
      this.prisma.collectionJob.findMany({
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
        include: {
          domain: {
            select: {
              id: true,
              name: true,
            },
          },
          nlpAnalysis: true,
          _count: {
            select: {
              posts: true,
            },
          },
        },
      }),
      this.prisma.collectionJob.count({ where }),
    ]);

    return {
      data: data.map((job) => this.mapJobResponse(job)),
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Builds CollectionJob filtering query.
   */
  private buildJobsWhere(
    query: GetCollectionJobsQueryDto,
  ): Prisma.CollectionJobWhereInput {
    const dateFilter = buildDateFilter(query);

    return {
      ...(query.domainId && { domainId: query.domainId }),
      ...(query.status && { status: query.status }),
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
      ...(query.language && { language: query.language }),

      ...(query.platform && {
        platforms: {
          array_contains: [query.platform],
        },
      }),

      ...(dateFilter ?? {}),

      ...(query.search?.trim() && {
        OR: [
          {
            country: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            city: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            region: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            domain: {
              name: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          },
        ],
      }),
    };
  }

  /**
   * Returns unique keywords from all active domains.
   *
   * Used when the selected domain is General.
   */
  async getAllActiveDomainKeywords(language: LanguageCode): Promise<string[]> {
    const keywords = await this.prisma.domainKeyword.findMany({
      where: {
        domain: {
          isActive: true,
        },
        OR:
          language === LanguageCode.ANY
            ? [{ language: LanguageCode.ANY }]
            : [{ language: LanguageCode.ANY }, { language }],
      },
      select: {
        keyword: true,
      },
    });

    return [...new Set(keywords.map((item) => item.keyword))];
  }

  /**
   * Returns all configured collection platforms with activation status.
   */
  async getPlatformsStatus() {
    return this.prisma.platform.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  private getDomainKeywordsByLanguage(
    domainKeywords: { keyword: string; language: LanguageCode }[],
    language: LanguageCode,
  ): string[] {
    return domainKeywords
      .filter((item) => {
        if (language === LanguageCode.ANY) return true;

        return item.language === LanguageCode.ANY || item.language === language;
      })
      .map((item) => item.keyword);
  }

  /**
   * Maps CollectionJob entity into a cleaner API response.
   */
  private mapJobResponse(job: CollectionJobResponseInput) {
    const platforms = Array.isArray(job.platforms) ? job.platforms : [];
    const keywords = Array.isArray(job.keywords) ? job.keywords : [];

    return {
      id: job.id,
      domainId: job.domainId,
      language: job.language,
      country: job.country,
      city: job.city,
      region: job.region,
      radiusKm: job.radiusKm,

      platforms,
      platformCount: platforms.length,
      keywords,

      status: job.status,
      totalPosts: job.totalPosts,
      totalComments: job.totalComments,
      actualPostsCount: job._count?.posts ?? 0,

      durationSeconds: this.calculateDurationSeconds(
        job.startedAt,
        job.completedAt,
      ),

      failedReason:
        job.status === CollectionJobStatus.FAILED
          ? job.failedReason
          : undefined,

      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,

      domain: job.domain
        ? {
            id: job.domain.id,
            name: job.domain.name,
          }
        : null,

      nlpStatus: job.nlpAnalysis ? 'COMPLETED' : 'NOT_STARTED',

      ...(job.domainKeywords && { domainKeywords: job.domainKeywords }),
      ...(Array.isArray(job.userKeywords) && {
        userKeywords: job.userKeywords,
      }),
    };
  }

  /**
   * Calculates job execution duration in seconds.
   */
  private calculateDurationSeconds(
    startedAt?: Date | null,
    completedAt?: Date | null,
  ): number | null {
    if (!startedAt || !completedAt) {
      return null;
    }

    return Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
  }
}
