import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, LanguageCode } from '@prisma/client';

import { RunCollectionDto } from './dto/run-collection.dto';
import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';
import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';
import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { CollectionJobService } from './collection-jobs/collection-job.service';
import { SocialPostService } from './social-posts/social-post.service';
import { SocialCommentService } from './social-comments/social-comment.service';
import { CollectorsFactory } from '../collectors/collectors.factory';
import { AuditService } from '../audit-logs/audit-logs.service';

/**
 * Main orchestration service for the data collection pipeline.
 *
 * Flow:
 * 1. Validate domain.
 * 2. Resolve domain keywords based on selected language.
 * 3. Validate selected platforms.
 * 4. Create a RUNNING collection job.
 * 5. Run collectors using domain keywords and optional user keywords.
 * 6. Store posts and comments.
 * 7. Mark the job as COMPLETED or FAILED.
 * 8. Record audit logs with full collection context.
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
    private readonly auditService: AuditService,
  ) {}

  /**
   * Starts a new data collection job.
   *
   * Domain keywords are used as the main discovery source.
   * User keywords are optional advanced filters provided in the request body.
   */
  async run(dto: RunCollectionDto, adminId: string) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    const domainKeywords = this.getDomainKeywordsByLanguage(
      domain.domainKeywords,
      dto.language,
    );

    const userKeywords = dto.keywords ?? [];

    this.collectionJobService.validateSupportedPlatforms(dto.platforms);

    const job = await this.collectionJobService.createRunningJob(dto);

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.RUN_DATA_COLLECTION,
      targetType: AuditTargetType.DATA_COLLECTION,
      targetId: job.id,
      newValue: {
        domainId: dto.domainId,
        domainName: domain.name,
        platforms: dto.platforms,
        country: dto.country,
        city: dto.city,
        region: dto.region,
        language: dto.language,
        radiusKm: dto.radiusKm,

        /**
         * Keywords used by the collection pipeline.
         *
         * domainKeywords:
         * - System-defined keywords attached to the selected domain.
         *
         * userKeywords:
         * - Optional keywords sent by the user/admin to narrow the search.
         */
        domainKeywords,
        userKeywords,
      },
    });

    try {
      let totalPosts = 0;
      let totalComments = 0;

      for (const platform of dto.platforms) {
        const collector = this.collectorsFactory.getCollector(platform);

        const posts = await collector.collect({
          domainName: domain.name,
          domainKeywords,
          country: dto.country,
          city: dto.city,
          region: dto.region,
          language: dto.language,
          radiusKm: dto.radiusKm,
          keywords: userKeywords,
        });

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
    } catch (error) {
      await this.collectionJobService.failJob(job.id, error);
      throw error;
    }
  }

  /**
   * Returns collection jobs summary status.
   */
  getStatus() {
    return this.collectionJobService.getStatus();
  }

  /**
   * Returns paginated collection jobs.
   */
  getJobs(query: GetCollectionJobsQueryDto) {
    return this.collectionJobService.findJobs(query);
  }

  /**
   * Returns detailed information about one collection job.
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
   * Filters domain keywords according to the requested language.
   *
   * If no language is provided, all domain keywords are returned.
   * If a language is provided, keywords with that language or ANY are returned.
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