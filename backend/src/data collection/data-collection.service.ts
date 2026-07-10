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

/**
 * Input used when data collection is started internally
 * during the idea-generation workflow.
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
 * Identifies who triggered the collection job.
 *
 * ADMIN_MANUAL:
 * Started explicitly by an administrator.
 *
 * SYSTEM_INTERNAL:
 * Started automatically by the idea-generation pipeline.
 */
type CollectionTrigger =
  | 'ADMIN_MANUAL'
  | 'SYSTEM_INTERNAL'
  | 'ADMIN_MANUAL_STOP';

/**
 * Main orchestration service for the data collection pipeline.
 *
 * Supports:
 * - Manual collection initiated by an Admin.
 * - Automatic internal collection for idea generation.
 * - General-domain fallback using all active domain keywords.
 * - Platform validation.
 * - Relevance filtering.
 * - Audit logging for start, completion, failure, and manual stopping.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  /**
   * Minimum score required for a collected post to be persisted.
   */
  private readonly MIN_RELEVANCE_SCORE = 60;

  /**
   * Reserved domain name used for collecting data
   * across all active domains.
   */
  private readonly GENERAL_DOMAIN_NAME = 'general';

  constructor(
    private readonly collectionJobService: CollectionJobService,
    private readonly socialPostService: SocialPostService,
    private readonly socialCommentService: SocialCommentService,
    private readonly collectorsFactory: CollectorsFactory,
    private readonly collectorQueueService: CollectorQueueService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Starts data collection manually by an administrator.
   *
   * When no platforms are explicitly provided, all active and
   * backend-supported platforms are selected.
   */
  async run(dto: RunCollectionDto, adminId: string) {
    const selectedPlatforms = dto.platforms?.length
      ? dto.platforms
      : await this.collectionJobService.getActiveSupportedPlatforms();

    return this.runInternal(dto, selectedPlatforms, 'ADMIN_MANUAL', adminId);
  }

  /**
   * Starts data collection internally during idea generation.
   *
   * This method does not require an administrator because it is
   * executed by the system's idea-generation workflow.
   */
  async runForIdeaGeneration(dto: IdeaGenerationCollectionInput) {
    const selectedPlatforms = dto.platforms?.length
      ? dto.platforms
      : await this.collectionJobService.getActiveSupportedPlatforms();

    return this.runInternal(dto, selectedPlatforms, 'SYSTEM_INTERNAL');
  }

  /**
   * Executes the shared data-collection workflow.
   *
   * The same pipeline is used for:
   * - Admin manual collection.
   * - Internal automatic collection.
   */
  private async runInternal(
    dto: IdeaGenerationCollectionInput,
    selectedPlatforms: CollectionSourceType[],
    trigger: CollectionTrigger,
    actorId?: string,
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

    await this.createStartAuditLog({
      actorId,
      trigger,
      jobId: job.id,
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
    });

    try {
      let totalPosts = 0;
      let totalComments = 0;

      for (const platform of selectedPlatforms) {
        const currentJob = await this.collectionJobService.findJobOrThrow(
          job.id,
        );

        /*
         * Stop checking occurs between platform collectors.
         *
         * The currently running external request cannot necessarily
         * be aborted, but the next platform will not be processed.
         */
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

      const completedJob = await this.collectionJobService.completeJob(job.id, {
        totalPosts,
        totalComments,
      });

      await this.auditService.createLog({
        actorId,
        action: AuditAction.COMPLETE_DATA_COLLECTION,
        targetType: AuditTargetType.DATA_COLLECTION,
        targetId: job.id,
        newValue: {
          trigger,
          status: CollectionJobStatus.COMPLETED,
          totalPosts,
          totalComments,
          completedAt: completedJob.completedAt,
        },
      });

      return completedJob;
    } catch (error: unknown) {
      const latestJob = await this.collectionJobService.findJobOrThrow(job.id);

      if (latestJob.status === CollectionJobStatus.STOPPED) {
        return latestJob;
      }

      const failedJob = await this.collectionJobService.failJob(job.id, error);

      await this.auditService.createLog({
        actorId,
        action: AuditAction.FAIL_DATA_COLLECTION,
        targetType: AuditTargetType.DATA_COLLECTION,
        targetId: job.id,
        newValue: {
          trigger,
          status: CollectionJobStatus.FAILED,
          failedReason: this.getErrorMessage(error),
          completedAt: failedJob.completedAt,
        },
      });

      throw error;
    }
  }

  /**
   * Creates the appropriate audit log according to the trigger.
   *
   * Manual Admin:
   * ADMIN_START_DATA_COLLECTION
   *
   * Internal system execution:
   * RUN_DATA_COLLECTION
   */
  private createStartAuditLog(params: {
    actorId?: string;
    trigger: CollectionTrigger;
    jobId: string;
    domainId: string;
    domainName: string;
    platforms: CollectionSourceType[];
    country: string;
    city?: string;
    region?: string;
    language: LanguageCode;
    radiusKm?: number;
    domainKeywords: string[];
    userKeywords: string[];
  }) {
    const action =
      params.trigger === 'ADMIN_MANUAL'
        ? AuditAction.ADMIN_START_DATA_COLLECTION
        : AuditAction.RUN_DATA_COLLECTION;

    return this.auditService.createLog({
      actorId: params.actorId,
      action,
      targetType: AuditTargetType.DATA_COLLECTION,
      targetId: params.jobId,
      newValue: {
        trigger: params.trigger,

        domainId: params.domainId,
        domainName: params.domainName,

        platforms: params.platforms,

        country: params.country,
        city: params.city,
        region: params.region,
        language: params.language,
        radiusKm: params.radiusKm,

        domainKeywords: params.domainKeywords,
        userKeywords: params.userKeywords,
      },
    });
  }

  /**
   * Returns the current state of the collection pipeline.
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

  /**
   * Returns paginated data collection jobs.
   */
  getJobs(query: GetCollectionJobsQueryDto) {
    return this.collectionJobService.findJobs(query);
  }

  /**
   * Returns details for one collection job.
   */
  getJobDetails(id: string) {
    return this.collectionJobService.findJobDetails(id);
  }

  /**
   * Returns paginated collected posts.
   */
  getPosts(query: GetSocialPostsQueryDto) {
    return this.socialPostService.findPosts(query);
  }

  /**
   * Returns paginated collected comments.
   */
  getComments(query: GetSocialCommentsQueryDto) {
    return this.socialCommentService.findComments(query);
  }

  /**
   * Stops a manually running collection job.
   *
   * This method is exposed only through the Admin controller.
   */
  async stop(id: string, adminId: string) {
    const stoppedJob = await this.collectionJobService.stopJob(id);

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_STOP_DATA_COLLECTION,
      targetType: AuditTargetType.DATA_COLLECTION,
      targetId: id,
      newValue: {
        trigger: 'ADMIN_MANUAL_STOP',
        status: stoppedJob.status,
        completedAt: stoppedJob.completedAt,
      },
    });

    return stoppedJob;
  }

  /**
   * Filters collected posts using the centralized relevance scorer.
   */
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

  /**
   * Returns domain keywords matching the selected language.
   *
   * ANY keywords apply to every language.
   */
  private getDomainKeywordsByLanguage(
    domainKeywords: {
      keyword: string;
      language: LanguageCode;
    }[],
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

  /**
   * Removes duplicate, blank, and untrimmed values.
   */
  private unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  /**
   * Checks whether the selected domain is the General domain.
   */
  private isGeneralDomain(domainName: string): boolean {
    return domainName.trim().toLowerCase() === this.GENERAL_DOMAIN_NAME;
  }

  /**
   * Converts an unknown error into a safe audit-log message.
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown collection error.';
  }
}
