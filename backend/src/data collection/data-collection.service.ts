import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType } from '@prisma/client';

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
 * 2. Validate selected platforms.
 * 3. Create a RUNNING collection job.
 * 4. Run collectors.
 * 5. Store posts and comments.
 * 6. Mark the job as COMPLETED or FAILED.
 * 7. Record admin audit logs.
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
   */
  async run(dto: RunCollectionDto, adminId: string) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    this.collectionJobService.validateSupportedPlatforms(dto.platforms);

    const job = await this.collectionJobService.createRunningJob(dto);

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_RUN_DATA_COLLECTION,
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
        keywords: dto.keywords ?? [],
      },
    });

    try {
      let totalPosts = 0;
      let totalComments = 0;

      for (const platform of dto.platforms) {
        const collector = this.collectorsFactory.getCollector(platform);

        const posts = await collector.collect({
          domainName: domain.name,
          country: dto.country,
          city: dto.city,
          region: dto.region,
          language: dto.language,
          radiusKm: dto.radiusKm,
          keywords: dto.keywords ?? [],
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
}