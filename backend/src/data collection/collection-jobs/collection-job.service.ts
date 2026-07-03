import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CollectionJobStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RunCollectionDto } from '../dto/run-collection.dto';
import { GetCollectionJobsQueryDto } from './dto/get-collection-jobs-query.dto';

import {
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for CollectionJob persistence and status management.
 *
 * @author Malak
 */
@Injectable()
export class CollectionJobService {
  constructor(private readonly prisma: PrismaService) { }

  async validateActiveDomain(domainId: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
    });

    if (!domain || !domain.isActive) {
      throw new NotFoundException('Active domain was not found.');
    }

    return domain;
  }

  async createRunningJob(dto: RunCollectionDto) {
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

  async findJobOrThrow(id: string) {
    const job = await this.prisma.collectionJob.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException('Collection job was not found.');
    }

    return job;
  }

  async completeJob(
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

  async failJob(id: string, error: unknown) {
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

  async findJobs(query: GetCollectionJobsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);

    const where: Prisma.CollectionJobWhereInput = {
      domainId: query.domainId,
      status: query.status,
      region: query.region,
    };

    const [data, total] = await Promise.all([
      this.prisma.collectionJob.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          query,
          ['createdAt', 'collectedAt', 'likesCount'] as const,
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