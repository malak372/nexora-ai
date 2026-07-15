import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  CollectionJobStatus,
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

import {
  CollectorInput,
  CollectorPost,
} from '../collectors/base/collector.types';

import { RelevanceScoreUtil } from '../collectors/base/relevance-score.util';

/**
 * Internal input used by the idea-generation workflow.
 */
export type IdeaGenerationCollectionInput = {
  domainId: string;

  country?: string;
  city?: string;
  region?: string;

  language: LanguageCode;

  radiusKm?: number;

  /**
   * DataSource.key values.
   */
  dataSourceKeys?: string[];

  keywords?: string[];
};

type CollectionTrigger =
  | 'USER_MANUAL'
  | 'SYSTEM_INTERNAL';

/**
 * Main orchestration service for the Data Collection stage.
 *
 * The user may start Data Collection manually. After completion,
 * the resulting CollectionJob can be supplied to the NLP stage.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  private readonly MIN_RELEVANCE_SCORE =
    60;

  private readonly GENERAL_DOMAIN_NAME =
    'general';

  constructor(
    private readonly collectionJobService:
      CollectionJobService,

    private readonly socialPostService:
      SocialPostService,

    private readonly socialCommentService:
      SocialCommentService,

    private readonly collectorsFactory:
      CollectorsFactory,

    private readonly collectorQueueService:
      CollectorQueueService,

    private readonly auditService:
      AuditService,
  ) {}

  /**
   * Starts Data Collection manually.
   *
   * The caller can be a registered user or administrator.
   */
  async run(
    dto: RunCollectionDto,
    actorId: string,
  ) {
    return this.runInternal(
      dto,
      'USER_MANUAL',
      actorId,
    );
  }

  /**
   * Starts Data Collection internally during
   * idea generation.
   */
  async runForIdeaGeneration(
    dto: IdeaGenerationCollectionInput,
  ) {
    return this.runInternal(
      dto,
      'SYSTEM_INTERNAL',
    );
  }

  /**
   * Executes the shared collection workflow.
   */
  private async runInternal(
    dto: IdeaGenerationCollectionInput,
    trigger: CollectionTrigger,
    actorId?: string,
  ) {
    const domain =
      await this.collectionJobService
        .validateActiveDomain(
          dto.domainId,
        );

    const dataSources =
      await this.collectionJobService
        .resolveActiveImplementedDataSources(
          dto.dataSourceKeys,
        );

    if (!dataSources.length) {
      throw new BadRequestException(
        'No active and implemented data sources are available.',
      );
    }

    const isGeneralDomain =
      this.isGeneralDomain(
        domain.name,
      );

    const domainKeywords =
      isGeneralDomain
        ? await this.collectionJobService
            .getAllActiveDomainKeywords(
              dto.language,
            )
        : this.getDomainKeywordsByLanguage(
            domain.domainKeywords,
            dto.language,
          );

    const userKeywords =
      this.unique(dto.keywords ?? []);

    const relevanceTerms =
      this.unique([
        ...(isGeneralDomain
          ? []
          : [domain.name]),

        ...domainKeywords,
        ...userKeywords,
      ]);

    const job =
      await this.collectionJobService
        .createRunningJob(
          dto,
          dataSources,
        );

    await this.createStartAuditLog({
      actorId,
      trigger,

      jobId: job.id,

      domainId: dto.domainId,

      domainName:
        isGeneralDomain
          ? 'General / All Domains'
          : domain.name,

      dataSourceKeys:
        dataSources.map(
          (source) => source.key,
        ),

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

      for (
        const dataSource of dataSources
      ) {
        const currentJob =
          await this.collectionJobService
            .findJobOrThrow(job.id);

        /*
         * Stop requests are checked between
         * external collector executions.
         */
        if (
          currentJob.status ===
          CollectionJobStatus.STOPPED
        ) {
          return currentJob;
        }

        const collector =
          this.collectorsFactory
            .getCollector(
              dataSource.key,
            );

        await this.collectionJobService
          .markSourceRunning(
            job.id,
            dataSource.id,
          );

        try {
          const collectorInput:
            CollectorInput = {
            domainName:
              isGeneralDomain
                ? 'All Domains'
                : domain.name,

            domainKeywords,

            country: dto.country,
            city: dto.city,
            region: dto.region,

            language:
              dto.language,

            radiusKm:
              dto.radiusKm,

            keywords:
              userKeywords,
          };

          const posts =
            await this.collectorQueueService
              .run(
                () =>
                  collector.collect(
                    collectorInput,
                  ),

                {
                  platform:
                    dataSource.key,
                },
              );

          const relevantPosts =
            this.filterRelevantPosts(
              posts,
              relevanceTerms,
            );

          const totals =
            await this.socialPostService
              .createManyWithComments(
                job.id,
                dataSource.id,

                {
                  country:
                    job.country,

                  city:
                    job.city,

                  region:
                    job.region,
                },

                relevantPosts,
              );

          await this.collectionJobService
            .markSourceCompleted(
              job.id,
              dataSource.id,
              totals,
            );

          totalPosts +=
            totals.totalPosts;

          totalComments +=
            totals.totalComments;
        } catch (error: unknown) {
          await this.collectionJobService
            .markSourceFailed(
              job.id,
              dataSource.id,
              error,
            );

          throw error;
        }
      }

      const completedJob =
        await this.collectionJobService
          .completeJob(job.id, {
            totalPosts,
            totalComments,
          });

      await this.auditService.createLog({
        actorId,

        action:
          AuditAction.COMPLETE_DATA_COLLECTION,

        targetType:
          AuditTargetType.DATA_COLLECTION,

        targetId: job.id,

        newValue: {
          trigger,

          status:
            CollectionJobStatus.COMPLETED,

          totalPosts,
          totalComments,

          completedAt:
            completedJob.completedAt,
        },
      });

      return completedJob;
    } catch (error: unknown) {
      const latestJob =
        await this.collectionJobService
          .findJobOrThrow(job.id);

      if (
        latestJob.status ===
        CollectionJobStatus.STOPPED
      ) {
        return latestJob;
      }

      const failedJob =
        await this.collectionJobService
          .failJob(
            job.id,
            error,
          );

      await this.auditService.createLog({
        actorId,

        action:
          AuditAction.FAIL_DATA_COLLECTION,

        targetType:
          AuditTargetType.DATA_COLLECTION,

        targetId: job.id,

        newValue: {
          trigger,

          status:
            CollectionJobStatus.FAILED,

          failedReason:
            this.getErrorMessage(error),

          completedAt:
            failedJob.completedAt,
        },
      });

      throw error;
    }
  }

  /**
   * Creates the start audit record.
   */
  private createStartAuditLog(
    params: {
      actorId?: string;
      trigger: CollectionTrigger;

      jobId: string;

      domainId: string;
      domainName: string;

      dataSourceKeys: string[];

      country?: string;
      city?: string;
      region?: string;

      language: LanguageCode;
      radiusKm?: number;

      domainKeywords: string[];
      userKeywords: string[];
    },
  ) {
    const action =
      params.trigger ===
      'USER_MANUAL'
        ? AuditAction.RUN_DATA_COLLECTION
        : AuditAction.RUN_DATA_COLLECTION;

    return this.auditService.createLog({
      actorId: params.actorId,
      action,

      targetType:
        AuditTargetType.DATA_COLLECTION,

      targetId: params.jobId,

      newValue: {
        trigger: params.trigger,

        domainId:
          params.domainId,

        domainName:
          params.domainName,

        dataSourceKeys:
          params.dataSourceKeys,

        country:
          params.country,

        city:
          params.city,

        region:
          params.region,

        language:
          params.language,

        radiusKm:
          params.radiusKm,

        domainKeywords:
          params.domainKeywords,

        userKeywords:
          params.userKeywords,
      },
    });
  }

  /**
   * Returns Data Collection health and status.
   */
  async getStatus() {
    return {
      service: 'Data Collection',
      available: true,

      queue:
        this.collectorQueueService
          .getStatus(),

      jobs:
        await this.collectionJobService
          .getStatus(),

      dataSources:
        await this.collectionJobService
          .getDataSourcesStatus(),
    };
  }

  getJobs(
    query: GetCollectionJobsQueryDto,
  ) {
    return this.collectionJobService
      .findJobs(query);
  }

  getJobDetails(id: string) {
    return this.collectionJobService
      .findJobDetails(id);
  }

  getPosts(
    query: GetSocialPostsQueryDto,
  ) {
    return this.socialPostService
      .findPosts(query);
  }

  getComments(
    query: GetSocialCommentsQueryDto,
  ) {
    return this.socialCommentService
      .findComments(query);
  }

  /**
   * Stops a running collection job.
   */
  async stop(
    id: string,
    adminId: string,
  ) {
    const stoppedJob =
      await this.collectionJobService
        .stopJob(id);

    await this.auditService.createLog({
      actorId: adminId,

      action:
        AuditAction.ADMIN_STOP_DATA_COLLECTION,

      targetType:
        AuditTargetType.DATA_COLLECTION,

      targetId: id,

      newValue: {
        trigger:
          'ADMIN_MANUAL_STOP',

        status:
          stoppedJob.status,

        completedAt:
          stoppedJob.completedAt,
      },
    });

    return stoppedJob;
  }

  /**
   * Filters posts using the centralized relevance scorer.
   */
  private filterRelevantPosts(
    posts: CollectorPost[],
    relevanceTerms: string[],
  ): CollectorPost[] {
    if (!relevanceTerms.length) {
      return posts;
    }

    return posts.filter((post) => {
      const score =
        RelevanceScoreUtil.scoreText({
          title: post.title,
          body: post.content,

          domainTerms:
            relevanceTerms,

          problemTerms: [],

          likes:
            post.likesCount,

          replies:
            post.repliesCount,

          publishedAt:
            post.publishedAt,
        });

      return (
        score >=
        this.MIN_RELEVANCE_SCORE
      );
    });
  }

  /**
   * Returns domain keywords applicable to the
   * selected language.
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
   * Removes duplicate, blank, and untrimmed values.
   */
  private unique(
    values: string[],
  ): string[] {
    return [
      ...new Set(
        values
          .map((value) =>
            value.trim(),
          )
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Determines whether the selected domain is General.
   */
  private isGeneralDomain(
    domainName: string,
  ): boolean {
    return (
      domainName
        .trim()
        .toLowerCase() ===
      this.GENERAL_DOMAIN_NAME
    );
  }

  /**
   * Converts an unknown error to a safe message.
   */
  private getErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : 'Unknown collection error.';
  }
}