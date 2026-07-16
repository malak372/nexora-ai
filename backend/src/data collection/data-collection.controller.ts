import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';

import { DataCollectionService } from './data-collection.service';

import { RunCollectionDto } from './dto/run-collection.dto';

import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';

/**
 * Minimal authenticated-user representation required
 * by the Data Collection controller.
 */
type AuthenticatedUser = {
  /**
   * Authenticated user identifier.
   */
  readonly id: string;

  /**
   * Authenticated user's current role.
   */
  readonly role: UserRole;
};

/**
 * Controller exposing the standalone Data Collection stage.
 *
 * Registered users can:
 * - Start collection jobs.
 * - View only their own collection jobs.
 * - View only posts and comments belonging to their jobs.
 *
 * Administrators can:
 * - View all collection jobs and collected content.
 * - Stop running collection jobs.
 *
 * Base route:
 * /data-collection
 *
 * @author Malak
 */
@Controller('data-collection')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
export class DataCollectionController {
  constructor(
    private readonly dataCollectionService:
      DataCollectionService,
  ) {}

  /**
   * Starts Data Collection manually.
   */
  @Post('run')
  @Roles(
    UserRole.USER,
    UserRole.ADMIN,
  )
  run(
    @Body()
    dto: RunCollectionDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .run(
        dto,
        user.id,
      );
  }

  /**
   * Returns queue, source, and caller-scoped job status.
   */
  @Get('status')
  @Roles(
    UserRole.USER,
    UserRole.ADMIN,
  )
  getStatus(
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .getStatus({
        userId:
          user.id,

        role:
          user.role,
      });
  }

  /**
   * Returns paginated jobs visible to the caller.
   */
  @Get('jobs')
  @Roles(
    UserRole.USER,
    UserRole.ADMIN,
  )
  getJobs(
    @Query()
    query: GetCollectionJobsQueryDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .getJobs(
        query,

        {
          userId:
            user.id,

          role:
            user.role,
        },
      );
  }

  /**
   * Returns detailed information about one visible job.
   */
  @Get('jobs/:id')
  @Roles(
    UserRole.USER,
    UserRole.ADMIN,
  )
  getJobDetails(
    @Param(
      'id',
      ParseUUIDPipe,
    )
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .getJobDetails(
        id,

        {
          userId:
            user.id,

          role:
            user.role,
        },
      );
  }

  /**
   * Returns collected posts visible to the caller.
   */
  @Get('posts')
  @Roles(
    UserRole.USER,
    UserRole.ADMIN,
  )
  getPosts(
    @Query()
    query: GetSocialPostsQueryDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .getPosts(
        query,

        {
          userId:
            user.id,

          role:
            user.role,
        },
      );
  }

  /**
   * Returns collected comments visible to the caller.
   */
  @Get('comments')
  @Roles(
    UserRole.USER,
    UserRole.ADMIN,
  )
  getComments(
    @Query()
    query: GetSocialCommentsQueryDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .getComments(
        query,

        {
          userId:
            user.id,

          role:
            user.role,
        },
      );
  }

  /**
   * Stops a running collection job.
   *
   * Only administrators may perform this operation.
   */
  @Post(':id/stop')
  @Roles(UserRole.ADMIN)
  stop(
    @Param(
      'id',
      ParseUUIDPipe,
    )
    id: string,

    @CurrentUser()
    admin: AuthenticatedUser,
  ) {
    return this.dataCollectionService
      .stop(
        id,
        admin.id,
      );
  }
}