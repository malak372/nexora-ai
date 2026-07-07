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
import { CollectorPost } from '../collectors/base/collector.types';
import { RelevanceScoreUtil } from '../collectors/base/relevance-score.util';

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
 * - Admin manual collection.
 * - Automatic collection for idea generation.
 * - General domain fallback using keywords from all active domains.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  private readonly MIN_RELEVANCE_SCORE = 60;
  private readonly GENERAL_DOMAIN_NAME = 'general';

  constructor(
    private readonly collectionJobService: CollectionJobService,
    private readonly socialPostService: SocialPostService,
    private readonly socialCommentService: SocialCommentService,
    private readonly collectorsFactory: CollectorsFactory,
    private readonly collectorQueueService: CollectorQueueService,
    private readonly auditService: AuditService,
  ) { }

  async run(dto: RunCollectionDto, adminId: string) {
    const selectedPlatforms = dto.platforms?.length
      ? dto.platforms
      : await this.collectionJobService.getActiveSupportedPlatforms();

    return this.runInternal(dto, selectedPlatforms, adminId);
  }

  async runForIdeaGeneration(dto: IdeaGenerationCollectionInput) {
    const selectedPlatforms = dto.platforms?.length
      ? dto.platforms
      : await this.collectionJobService.getActiveSupportedPlatforms();

    return this.runInternal(dto, selectedPlatforms, null);
  }

  private async runInternal(
    dto: IdeaGenerationCollectionInput,
    selectedPlatforms: CollectionSourceType[],
    adminId: string | null,
  ) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    const isGeneralDomain = this.isGeneralDomain(domain.name);

    const domainKeywords = isGeneralDomain
      ? await this.collectionJobService.getAllActiveDomainKeywords(dto.language)
      : this.getDomainKeywordsByLanguage(domain.domainKeywords, dto.language);

    const userKeywords = dto.keywords ?? [];

    const relevanceTerms = this.unique([
      ...(isGeneralDomain ? [] : [domain.name]),
      ...domainKeywords,
      ...userKeywords,
    ]);

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
          domainName: isGeneralDomain ? 'General / All Domains' : domain.name,
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
          domainName: isGeneralDomain ? 'All Domains' : domain.name,
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

        const relevantPosts = this.filterRelevantPosts(posts, relevanceTerms);

        const totals = await this.socialPostService.createManyWithComments(
          job.id,
          {
            country: job.country,
            city: job.city,
            region: job.region,
          },
          relevantPosts,
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
   * Returns the current status of the data collection service.
   */
  async getStatus() {
    return {
      service: 'Data Collection',
      available: true,
      queue: this.collectorQueueService.getStatus(),
      jobs: await this.collectionJobService.getStatus(),
      platforms: await this.collectionJobService.getPlatformsStatus(),
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

  private filterRelevantPosts(
    posts: CollectorPost[],
    relevanceTerms: string[],
  ): CollectorPost[] {
    if (!relevanceTerms.length) {
      return posts;
    }

    return posts.filter((post) => {
      const score = RelevanceScoreUtil.scoreText({
        title: post.title,
        body: post.content,
        domainTerms: relevanceTerms,
        problemTerms: [],
        likes: post.likesCount,
        replies: post.repliesCount,
        publishedAt: post.publishedAt,
      });

      return score >= this.MIN_RELEVANCE_SCORE;
    });
  }

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

  private unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private isGeneralDomain(domainName: string): boolean {
    return domainName.trim().toLowerCase() === this.GENERAL_DOMAIN_NAME;
  }
}