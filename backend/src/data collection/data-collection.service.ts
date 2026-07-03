import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  CollectionJobStatus,
} from '@prisma/client';

import { RunCollectionDto } from './dto/run-collection.dto';
import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';
import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';
import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { CollectionJobService } from './collection-jobs/collection-job.service';
import { SocialPostsService } from './social-posts/social-post.service';
import { SocialCommentService } from './social-comments/social-comment.service';
import { AuditService } from '../audit-logs/audit-logs.service';

/**
 * Main orchestration service for the data collection pipeline.
 *
 * Responsibilities:
 * - Start collection jobs.
 * - Stop running jobs.
 * - Coordinate post/comment storage.
 * - Delegate listing to child services.
 * - Record system audit logs.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  constructor(
    private readonly collectionJobService: CollectionJobService,
    private readonly socialPostsService: SocialPostsService,
    private readonly socialCommentService: SocialCommentService,
    private readonly auditService: AuditService,
  ) {}

  async run(dto: RunCollectionDto, adminId: string) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    const job = await this.collectionJobService.createRunningJob(dto);

    try {
      const posts = this.buildMockCollectedPosts(dto, domain.name);

      const result = await this.socialPostsService.createManyWithComments(
        job.id,
        posts,
        dto,
      );

      const completedJob = await this.collectionJobService.completeJob(job.id, {
        totalPosts: result.totalPosts,
        totalComments: result.totalComments,
      });

      await this.auditService.createLog({
        actorId: adminId,
        action: AuditAction.ADMIN_RUN_DATA_COLLECTION,
        targetType: AuditTargetType.DATA_COLLECTION,
        targetId: completedJob.id,
        oldValue: null,
        newValue: {
          domainId: dto.domainId,
          domainName: domain.name,
          platforms: dto.platforms,
          keywords: dto.keywords ?? [],
          region: dto.region,
          totalPosts: result.totalPosts,
          totalComments: result.totalComments,
        },
      });

      return completedJob;
    } catch (error) {
      await this.collectionJobService.failJob(job.id, error);
      throw error;
    }
  }

  getStatus() {
    return this.collectionJobService.getStatus();
  }

  getJobs(query: GetCollectionJobsQueryDto) {
    return this.collectionJobService.findJobs(query);
  }

  getPosts(query: GetSocialPostsQueryDto) {
    return this.socialPostsService.findPosts(query);
  }

  getComments(query: GetSocialCommentsQueryDto) {
    return this.socialCommentService.findComments(query);
  }

  async stop(id: string, adminId: string) {
    const oldJob = await this.collectionJobService.findJobOrThrow(id);

    const stoppedJob = await this.collectionJobService.stopJob(id);

    await this.auditService.createLog({
      actorId:adminId,
      action: AuditAction.ADMIN_STOP_DATA_COLLECTION,
      targetType: AuditTargetType.DATA_COLLECTION,
      targetId: stoppedJob.id,
      oldValue: {
        status: oldJob.status,
      },
      newValue: {
        status: CollectionJobStatus.STOPPED,
      },
    });

    return stoppedJob;
  }

  /**
   * Temporary mock collector.
   * Later this can be replaced with real collectors.
   */
  private buildMockCollectedPosts(dto: RunCollectionDto, domainName: string) {
    const region = dto.region ?? dto.city ?? dto.country ?? 'local community';

    return [
      {
        externalId: `mock-post-${Date.now()}-1`,
        title: `${domainName} issue in ${region}`,
        content: `People in ${region} are discussing recurring problems related to ${domainName}.`,
        author: 'mock_user_1',
        url: null,
        language: 'en',
        likesCount: 24,
        comments: [
          {
            externalId: `mock-comment-${Date.now()}-1`,
            content:
              'The current process is slow and difficult. We need a better digital solution.',
            author: 'mock_commenter_1',
            language: 'en',
            likesCount: 8,
          },
          {
            externalId: `mock-comment-${Date.now()}-2`,
            content:
              'Many users still depend on manual work, which causes mistakes.',
            author: 'mock_commenter_2',
            language: 'en',
            likesCount: 5,
          },
        ],
      },
    ];
  }
}