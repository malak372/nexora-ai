import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  CollectionJobStatus,
  CollectionSourceType,
  LanguageCode,
} from '@prisma/client';

import { RunCollectionDto } from './dto/run-collection.dto';
import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';
import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';
import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { CollectionJobService } from './collection-jobs/collection-job.service';
import { SocialPostService } from './social-posts/social-post.service';
import { SocialCommentService } from './social-comments/social-comment.service';
import { CollectorsFactory } from '../collectors/collectors.factory';
import { AuditService } from '../audit-logs/audit-logs.service';
import { CollectorQueueService } from '../collectors/base/collector-queue.service';

/**
 * Input used internally when idea generation needs fresh collection data.
 *
 * Unlike RunCollectionDto, platforms are optional here:
 * - If provided, the system uses them.
 * - If missing, the system uses all active supported platforms.
 */
export type IdeaGenerationCollectionInput = {
  domainId: string;
  country: string;
  city?: string;
  region?: string;
  language: LanguageCode;
  radiusKm?: number;
  platforms?: CollectionSourceType[];
  keywords?: string[];
};

/**
 * Main orchestration service for the data collection pipeline.
 *
 * Supports:
 * - Admin manual data collection.
 * - Automatic data collection from idea generation pipeline.
 *
 * Responsibilities:
 * - Validate domain and selected platforms.
 * - Create and update collection jobs.
 * - Run collectors through CollectorQueueService.
 * - Persist collected posts and comments.
 * - Write admin audit logs.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  constructor(
    private readonly collectionJobService: CollectionJobService,
    private readonly socialPostService: SocialPostService,
    private readonly socialCommentService: SocialCommentService,
    private readonly collectorsFactory: CollectorsFactory,
    private readonly collectorQueueService: CollectorQueueService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Starts a manual data collection job by Admin.
   *
   * Admin must explicitly send platforms.
   */
  async run(dto: RunCollectionDto, adminId: string) {
    return this.runInternal(dto, dto.platforms, adminId);
  }

  /**
   * Starts an automatic collection job for idea generation.
   *
   * Used when /ideas/generate needs fresh community data.
   */
  async runForIdeaGeneration(dto: IdeaGenerationCollectionInput) {
    const selectedPlatforms = dto.platforms?.length
      ? dto.platforms
      : await this.collectionJobService.getActiveSupportedPlatforms();

    return this.runInternal(dto, selectedPlatforms, null);
  }

  /**
   * Shared collection runner.
   *
   * Used by:
   * - Admin manual collection.
   * - Automatic idea-generation collection.
   */
  private async runInternal(
    dto: IdeaGenerationCollectionInput,
    selectedPlatforms: CollectionSourceType[],
    adminId: string | null,
  ) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    const domainKeywords = this.getDomainKeywordsByLanguage(
      domain.domainKeywords,
      dto.language,
    );

    const userKeywords = dto.keywords ?? [];

    this.collectionJobService.validateSupportedPlatforms(selectedPlatforms);

    for (const platform of selectedPlatforms) {
      await this.collectionJobService.validateActivePlatform(platform);
    }

    const job = await this.collectionJobService.createRunningJob(
      dto,
      selectedPlatforms,
    );

    if (adminId) {
      await this.auditService.createLog({
        actorId: adminId,
        action: AuditAction.RUN_DATA_COLLECTION,
        targetType: AuditTargetType.DATA_COLLECTION,
        targetId: job.id,
        newValue: {
          trigger: 'ADMIN_MANUAL',
          domainId: dto.domainId,
          domainName: domain.name,
          platforms: selectedPlatforms,
          country: dto.country,
          city: dto.city,
          region: dto.region,
          language: dto.language,
          radiusKm: dto.radiusKm,
          domainKeywords,
          userKeywords,
        },
      });
    }

    try {
      let totalPosts = 0;
      let totalComments = 0;

      for (const platform of selectedPlatforms) {
        const currentJob = await this.collectionJobService.findJobOrThrow(
          job.id,
        );

        if (currentJob.status === CollectionJobStatus.STOPPED) {
          return currentJob;
        }

        const collector = this.collectorsFactory.getCollector(platform);

        const collectorInput = {
          domainName: domain.name,
          domainKeywords,
          country: dto.country,
          city: dto.city,
          region: dto.region,
          language: dto.language,
          radiusKm: dto.radiusKm,
          keywords: userKeywords,
        };

        const posts = await this.collectorQueueService.run(
          () => collector.collect(collectorInput),
          platform,
        );

        const totals = await this.socialPostService.createManyWithComments(
          job.id,
          posts,
        );

        totalPosts += totals.totalPosts;
        totalComments += totals.totalComments;
      }

      return this.collectionJobService.completeJob(job.id, {
        totalPosts,
        totalComments,
      });
    } catch (error: unknown) {
      const latestJob = await this.collectionJobService.findJobOrThrow(job.id);

      if (latestJob.status === CollectionJobStatus.STOPPED) {
        return latestJob;
      }

      await this.collectionJobService.failJob(job.id, error);
      throw error;
    }
  }

  /**
   * Returns service health/status including queue state.
   */
  async getStatus() {
    return {
      service: 'Data Collection',
      status: 'RUNNING',
      queue: this.collectorQueueService.getStatus(),
      jobs: await this.collectionJobService.getStatus(),
      supportedPlatforms: this.collectorsFactory.getSupportedPlatforms(),
      notes: {
        github: 'Public issues and comments are supported.',
        youtube: 'Public videos and top-level comments are supported.',
        x: 'Implemented, but live access depends on X API credits and plan.',
      },
    };
  }

  getJobs(query: GetCollectionJobsQueryDto) {
    return this.collectionJobService.findJobs(query);
  }

  getJobDetails(id: string) {
    return this.collectionJobService.findJobDetails(id);
  }

  getPosts(query: GetSocialPostsQueryDto) {
    return this.socialPostService.findPosts(query);
  }

  getComments(query: GetSocialCommentsQueryDto) {
    return this.socialCommentService.findComments(query);
  }

  /**
   * Stops a running collection job.
   */
  async stop(id: string, adminId: string) {
    const stoppedJob = await this.collectionJobService.stopJob(id);

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_STOP_DATA_COLLECTION,
      targetType: AuditTargetType.DATA_COLLECTION,
      targetId: id,
      newValue: {
        status: stoppedJob.status,
        completedAt: stoppedJob.completedAt,
      },
    });

    return stoppedJob;
  }

  /**
   * Returns domain keywords matching the requested language.
   */
  private getDomainKeywordsByLanguage(
    domainKeywords: { keyword: string; language: LanguageCode }[],
    language: LanguageCode,
  ): string[] {
    return domainKeywords
      .filter((item) => {
        if (language === LanguageCode.ANY) {
          return true;
        }

        return item.language === LanguageCode.ANY || item.language === language;
      })
      .map((item) => item.keyword);
  }
}