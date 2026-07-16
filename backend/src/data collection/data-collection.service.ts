import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  CollectionJobStatus,
  LanguageCode,
} from '@prisma/client';

import { AuditService } from '../audit-logs/audit-logs.service';

import { CollectorQueueService } from '../collectors/base/collector-queue.service';

import {
  CollectorInput,
  CollectorPost,
} from '../collectors/base/collector.types';

import { RelevanceScoreUtil } from '../collectors/base/relevance-score.util';

import { CollectorsFactory } from '../collectors/collectors.factory';

import { CollectionJobService } from './collection-jobs/collection-job.service';

import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';

import { RunCollectionDto } from './dto/run-collection.dto';

import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { SocialCommentService } from './social-comments/social-comment.service';

import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';

import { SocialPostService } from './social-posts/social-post.service';

import { CollectionAccessContext } from './types/collection-access-context.type';

/**
 * Input used when the idea-generation pipeline
 * starts Data Collection internally.
 */
export type IdeaGenerationCollectionInput = {
  /**
   * Authenticated user who owns the generated job.
   *
   * Undefined is allowed for guest or system jobs.
   */
  readonly userId?: string;

  readonly domainId: string;

  readonly country?: string;
  readonly city?: string;
  readonly region?: string;

  readonly language: LanguageCode;

  readonly radiusKm?: number;

  /**
   * Selected DataSource.key values.
   */
  readonly dataSourceKeys?: string[];

  readonly keywords?: string[];
};

/**
 * Identifies how Data Collection was started.
 */
type CollectionTrigger = 'USER_MANUAL' | 'SYSTEM_INTERNAL';

/**
 * Main orchestration service for the Data Collection pipeline.
 *
 * Important behavior:
 * - Persists collection-job ownership directly.
 * - Continues running after one source fails.
 * - Fails the parent job only when every source fails.
 * - Checks stop requests before and after external collection.
 * - Enforces user ownership when reading data.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  /**
   * Minimum score required before a post is stored.
   */
  private readonly MIN_RELEVANCE_SCORE = 60;

  /**
   * Reserved domain name representing all domains.
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
   * Starts Data Collection manually for
   * an authenticated user or administrator.
   */
  run(dto: RunCollectionDto, userId: string) {
    return this.runInternal(dto, 'USER_MANUAL', userId);
  }

  /**
   * Starts Data Collection internally as part
   * of the idea-generation workflow.
   */
  runForIdeaGeneration(dto: IdeaGenerationCollectionInput) {
    return this.runInternal(dto, 'SYSTEM_INTERNAL', dto.userId);
  }

  /**
   * Executes the shared Data Collection workflow.
   */
  private async runInternal(
    dto: RunCollectionDto | IdeaGenerationCollectionInput,

    trigger: CollectionTrigger,

    actorId?: string,
  ) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    const dataSources =
      await this.collectionJobService.resolveActiveImplementedDataSources(
        dto.dataSourceKeys,
      );

    const isGeneralDomain = this.isGeneralDomain(domain.name);

    const domainKeywords = isGeneralDomain
      ? await this.collectionJobService.getAllActiveDomainKeywords(dto.language)
      : this.getDomainKeywordsByLanguage(domain.domainKeywords, dto.language);

    const userKeywords = this.unique(dto.keywords ?? []);

    const relevanceTerms = this.unique([
      ...(isGeneralDomain ? [] : [domain.name]),

      ...domainKeywords,
      ...userKeywords,
    ]);

    const job = await this.collectionJobService.createRunningJob(
      dto,
      dataSources,
      actorId,
    );

    await this.auditService.createLog({
      actorId,

      action: AuditAction.RUN_DATA_COLLECTION,

      targetType: AuditTargetType.DATA_COLLECTION,

      targetId: job.id,

      newValue: {
        trigger,

        domainId: dto.domainId,

        domainName: isGeneralDomain ? 'General / All Domains' : domain.name,

        dataSourceKeys: dataSources.map((source) => source.key),

        country: dto.country,

        city: dto.city,

        region: dto.region,

        language: dto.language,

        radiusKm: dto.radiusKm,

        domainKeywords,
        userKeywords,
      },
    });

    let totalPosts = 0;
    let totalComments = 0;

    let completedSources = 0;
    let failedSources = 0;

    try {
      for (const dataSource of dataSources) {
        /*
         * Check whether an administrator stopped the job
         * before starting the next collector.
         */
        if (await this.isStopped(job.id)) {
          await this.collectionJobService.markRemainingSourcesStopped(job.id);

          return this.collectionJobService.findJobOrThrow(job.id);
        }

        await this.collectionJobService.markSourceRunning(
          job.id,
          dataSource.id,
        );

        try {
          const collector = this.collectorsFactory.getCollector(dataSource.key);

          const collectorInput: CollectorInput = {
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

            {
              platform: dataSource.key,
            },
          );

          /*
           * A collector may finish after the Admin has
           * stopped the job.
           *
           * Check again before saving the returned data.
           */
          if (await this.isStopped(job.id)) {
            await this.collectionJobService.markRemainingSourcesStopped(job.id);

            return this.collectionJobService.findJobOrThrow(job.id);
          }

          const relevantPosts = this.filterRelevantPosts(posts, relevanceTerms);

          const totals = await this.socialPostService.createManyWithComments(
            job.id,
            dataSource.id,

            {
              country: dto.country,

              city: dto.city,

              region: dto.region,
            },

            relevantPosts,
          );

          await this.collectionJobService.markSourceCompleted(
            job.id,
            dataSource.id,
            totals,
          );

          totalPosts += totals.totalPosts;

          totalComments += totals.totalComments;

          completedSources += 1;
        } catch (error: unknown) {
          failedSources += 1;

          /*
           * One source failure should not stop all remaining
           * source collectors.
           */
          await this.collectionJobService.markSourceFailed(
            job.id,
            dataSource.id,
            error,
          );
        }
      }

      /*
       * The parent job fails only when every selected source
       * failed. A successful source returning zero posts is
       * still considered a successful source execution.
       */
      if (completedSources === 0) {
        throw new ServiceUnavailableException(
          'All selected data sources failed.',
        );
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

          completedSources,
          failedSources,

          totalPosts,
          totalComments,

          completedAt: completedJob.completedAt,
        },
      });

      return completedJob;
    } catch (error: unknown) {
      const latestJob = await this.collectionJobService.findJobOrThrow(job.id);

      /*
       * Do not overwrite a stopped job with FAILED.
       */
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

          completedSources,
          failedSources,

          failedReason: this.getErrorMessage(error),

          completedAt: failedJob.completedAt,
        },
      });

      throw error;
    }
  }

  /**
   * Returns caller-scoped collection-job status together
   * with the shared queue and data-source state.
   */
  async getStatus(access: CollectionAccessContext) {
    return {
      service: 'Data Collection',

      available: true,

      queue: this.collectorQueueService.getStatus(),

      jobs: await this.collectionJobService.getStatus(access),

      dataSources: await this.collectionJobService.getDataSourcesStatus(),
    };
  }

  /**
   * Returns collection jobs visible to the caller.
   */
  getJobs(query: GetCollectionJobsQueryDto, access: CollectionAccessContext) {
    return this.collectionJobService.findJobs(query, access);
  }

  /**
   * Returns one collection job visible to the caller.
   */
  getJobDetails(id: string, access: CollectionAccessContext) {
    return this.collectionJobService.findJobDetails(id, access);
  }

  /**
   * Returns collected posts visible to the caller.
   */
  getPosts(query: GetSocialPostsQueryDto, access: CollectionAccessContext) {
    return this.socialPostService.findPosts(query, access);
  }

  /**
   * Returns collected comments visible to the caller.
   */
  getComments(
    query: GetSocialCommentsQueryDto,
    access: CollectionAccessContext,
  ) {
    return this.socialCommentService.findComments(query, access);
  }

  /**
   * Stops a running collection job.
   *
   * The controller restricts this operation to Admin.
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
   * Checks whether a collection job was stopped.
   */
  private async isStopped(jobId: string): Promise<boolean> {
    const job = await this.collectionJobService.findJobOrThrow(jobId);

    return job.status === CollectionJobStatus.STOPPED;
  }

  /**
   * Filters collector results using shared relevance scoring.
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
   * Returns domain keywords compatible with
   * the requested language.
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
          language === LanguageCode.ANY ||
          item.language === LanguageCode.ANY ||
          item.language === language,
      )
      .map((item) => item.keyword.trim())
      .filter(Boolean);
  }

  /**
   * Trims, removes empty values, and deduplicates strings.
   */
  private unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  /**
   * Identifies the reserved general domain.
   */
  private isGeneralDomain(domainName: string): boolean {
    return domainName.trim().toLowerCase() === this.GENERAL_DOMAIN_NAME;
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown collection error.';
  }
}
