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
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';
import { PLATFORM_NAMES } from '../../collectors/base/platform-name.constant';

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

  /**
   * Validates that the selected domain exists and is active.
   */
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

  /**
   * Validates that all requested platforms have registered collectors.
   */
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

  /**
   * Validates that the selected platform exists and is active in DB.
   */
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

  /**
   * Creates a collection job in RUNNING state.
   */
  createRunningJob(dto: RunCollectionDto) {
    return this.prisma.collectionJob.create({
      data: {
        domainId: dto.domainId,
        platforms: dto.platforms,
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

  /**
   * Finds a collection job or throws NotFoundException.
   */
  async findJobOrThrow(id: string) {
    const job = await this.prisma.collectionJob.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException('Collection job was not found.');
    }

    return job;
  }

  /**
   * Checks whether a job was stopped.
   *
   * Used by the runner before starting each platform collector.
   */
  async isJobStopped(id: string): Promise<boolean> {
    const job = await this.findJobOrThrow(id);

    return job.status === CollectionJobStatus.STOPPED;
  }

  /**
   * Returns detailed information about one collection job.
   */
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
        _count: {
          select: {
            posts: true,
            nlpAnalyses: true,
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Collection job was not found.');
    }

    const domainKeywords = this.getDomainKeywordsByLanguage(
      job.domain.domainKeywords,
      job.language ?? undefined,
    );

    return {
      id: job.id,
      domainId: job.domainId,
      country: job.country,
      city: job.city,
      region: job.region,
      radiusKm: job.radiusKm,
      platforms: job.platforms,
      language: job.language,
      status: job.status,
      totalPosts: job.totalPosts,
      totalComments: job.totalComments,
      failedReason: job.failedReason,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,

      domain: {
        id: job.domain.id,
        name: job.domain.name,
      },

      domainKeywords,
      userKeywords: job.keywords,

      _count: job._count,
    };
  }

  /**
   * Marks a collection job as completed.
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

  /**
   * Marks a collection job as failed and stores the failure reason.
   */
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

  /**
   * Stops a currently running collection job.
   */
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

  /**
   * Returns collection jobs summary status.
   */
  async getStatus() {
    const [runningJobs, completedJobs, failedJobs, stoppedJobs] =
      await Promise.all([
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
      runningJobs,
      completedJobs,
      failedJobs,
      stoppedJobs,
      isRunning: runningJobs > 0,
    };
  }

  /**
   * Returns paginated collection jobs with filtering and sorting.
   */
  async findJobs(query: GetCollectionJobsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);

    const where: Prisma.CollectionJobWhereInput = {
      ...(query.domainId && { domainId: query.domainId }),
      ...(query.status && { status: query.status }),
      ...(query.region && { region: query.region }),
    };

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
          _count: {
            select: {
              posts: true,
              nlpAnalyses: true,
            },
          },
        },
      }),
      this.prisma.collectionJob.count({ where }),
    ]);

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
   * Filters domain keywords according to a selected job language.
   */
  private getDomainKeywordsByLanguage(
    domainKeywords: { keyword: string; language: LanguageCode }[],
    language?: string,
  ): string[] {
    const requestedLanguage = language?.toUpperCase() as
      | LanguageCode
      | undefined;

    return domainKeywords
      .filter((item) => {
        if (!requestedLanguage || requestedLanguage === LanguageCode.ANY) {
          return true;
        }

        return (
          item.language === LanguageCode.ANY ||
          item.language === requestedLanguage
        );
      })
      .map((item) => item.keyword);
  }
}