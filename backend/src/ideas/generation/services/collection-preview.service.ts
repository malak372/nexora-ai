import { Injectable } from '@nestjs/common';

import { CollectionJobStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS } from '../constants/idea-generation.constants';

import { CollectionPreviewDto } from '../dto/collection-preview.dto';

import { DomainResolutionService } from './domain-resolution.service';

/**
 * Provides a preview of reusable collection data before
 * starting a new idea-generation run.
 *
 * Responsibilities:
 * - Resolve the requested domain.
 * - Find the latest completed collection job for the same context.
 * - Determine whether the collected data is still reusable.
 * - Return freshness, expiration, and collection-volume information.
 *
 * This service does not:
 * - Start a new collection job.
 * - Refresh existing collection data.
 * - Generate an idea.
 *
 * @author Eman
 */
@Injectable()
export class CollectionPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domainResolver: DomainResolutionService,
  ) {}

  /**
   * Checks whether a recent completed collection job can be reused
   * for the requested idea-generation context.
   *
   * Reuse matching is based on:
   * - Resolved domain.
   * - Country.
   * - City.
   * - Region.
   * - Language.
   * - Completed collection-job status.
   *
   * @param userId Authenticated user identifier.
   * @param dto Collection-preview request data.
   * @returns Reusable collection-job information and freshness metadata.
   */
  async preview(userId: string, dto: CollectionPreviewDto) {
    const resolvedDomain = await this.domainResolver.resolve({
      userId,
      domainId: dto.domainId,
      description: dto.description,
      keywords: dto.keywords,
      language: dto.language,
    });

    const normalizedCountry = dto.country.trim();
    const normalizedCity = dto.city?.trim() || null;
    const normalizedRegion = dto.region?.trim() || null;

    const collectionJob = await this.prisma.collectionJob.findFirst({
      where: {
        domainId: resolvedDomain.domainId,
        status: CollectionJobStatus.COMPLETED,
        country: {
          equals: normalizedCountry,
          mode: 'insensitive',
        },
        city: normalizedCity,
        region: normalizedRegion,
        language: dto.language,
        completedAt: {
          not: null,
        },
      },
      orderBy: {
        completedAt: 'desc',
      },
      select: {
        id: true,
        completedAt: true,
        totalPosts: true,
        totalComments: true,
      },
    });

    if (!collectionJob?.completedAt) {
      return {
        hasReusableData: false,
        resolvedDomainId: resolvedDomain.domainId,
        domainResolutionSource: resolvedDomain.source,
        canRefresh: true,
      };
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;

    const maximumReusableAgeMilliseconds =
      REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS * millisecondsPerDay;

    const collectionAgeMilliseconds = Math.max(
      0,
      Date.now() - collectionJob.completedAt.getTime(),
    );

    const isFresh = collectionAgeMilliseconds <= maximumReusableAgeMilliseconds;

    return {
      hasReusableData: isFresh,
      collectionJobId: collectionJob.id,
      resolvedDomainId: resolvedDomain.domainId,
      domainResolutionSource: resolvedDomain.source,
      lastCollectedAt: collectionJob.completedAt,
      ageInDays: Math.floor(collectionAgeMilliseconds / millisecondsPerDay),
      expiresAt: new Date(
        collectionJob.completedAt.getTime() + maximumReusableAgeMilliseconds,
      ),
      isFresh,
      canRefresh: true,
      totalPosts: collectionJob.totalPosts,
      totalComments: collectionJob.totalComments,
    };
  }
}
