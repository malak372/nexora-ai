import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CollectionJobStatus,
  CollectionSourceType,
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

/**
 * Service responsible for CollectionJob persistence and status management.
 *
 * Responsibilities:
 * - Validate active domains.
 * - Validate requested platforms.
 * - Create running jobs.
 * - Mark jobs as completed, failed, or stopped.
 * - Return collection job status and paginated history.
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
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
    });

    if (!domain || !domain.isActive) {
      throw new NotFoundException('Active domain was not found.');
    }

    return domain;
  }

  /**
   * Validates that all requested platforms have collectors registered.
   */
  validateSupportedPlatforms(platforms: CollectionSourceType[]) {
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
   * Creates a collection job in RUNNING state.
   */
  createRunningJob(dto: RunCollectionDto) {
    return this.prisma.collectionJob.create({
      data: {
        domainId: dto.domainId,
        country: dto.country,
        city: dto.city,
        region: dto.region,
        radiusKm: dto.radiusKm,
        platforms: dto.platforms,
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
}