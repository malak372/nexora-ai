
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
   * Identifier of the authenticated user.
   */
  id: string;

  /**
   * Current application role.
   */
  role: UserRole;
};

/**
 * Controller exposing the Data Collection pipeline stage.
 *
 * Registered users can:
 * - Start a collection job manually.
 * - View collection-job status.
 * - View collection jobs.
 * - View collected posts.
 * - View collected comments.
 *
 * The generated collectionJobId can later be supplied
 * to the NLP stage and then to the idea-generation stage.
 *
 * Administrators have the same permissions and can also
 * stop running collection jobs.
 *
 * Base route:
 * /data-collection
 *
 * @author Malak
 */
@Controller('data-collection')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataCollectionController {
  constructor(
    private readonly dataCollectionService: DataCollectionService,
  ) {}

  /**
   * Starts the Data Collection pipeline stage manually.
   *
   * This endpoint is used directly by registered users
   * before starting NLP analysis and idea generation.
   *
   * The operation is not restricted to administrators and
   * is not considered an internal system-only operation.
   *
   * @param dto Collection configuration selected by the user.
   * @param user Authenticated user starting the collection.
   * @returns Created and executed collection job.
   */
  @Post('run')
  @Roles(UserRole.USER, UserRole.ADMIN)
  run(
    @Body() dto: RunCollectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dataCollectionService.run(dto, user.id);
  }

  /**
   * Returns the general state of the Data Collection stage,
   * including queue, job, and data-source status.
   */
  @Get('status')
  @Roles(UserRole.USER, UserRole.ADMIN)
  getStatus() {
    return this.dataCollectionService.getStatus();
  }

  /**
   * Returns paginated collection jobs.
   *
   * A completed job can be selected by the user
   * for the following NLP stage.
   */
  @Get('jobs')
  @Roles(UserRole.USER, UserRole.ADMIN)
  getJobs(
    @Query() query: GetCollectionJobsQueryDto,
  ) {
    return this.dataCollectionService.getJobs(query);
  }

  /**
   * Returns detailed information about one collection job.
   *
   * The response includes source-level execution status,
   * totals, collected-post count, and NLP stage status.
   */
  @Get('jobs/:id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  getJobDetails(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dataCollectionService.getJobDetails(id);
  }

  /**
   * Returns paginated posts collected during
   * Data Collection jobs.
   */
  @Get('posts')
  @Roles(UserRole.USER, UserRole.ADMIN)
  getPosts(
    @Query() query: GetSocialPostsQueryDto,
  ) {
    return this.dataCollectionService.getPosts(query);
  }

  /**
   * Returns paginated comments collected from
   * supported data sources.
   */
  @Get('comments')
  @Roles(UserRole.USER, UserRole.ADMIN)
  getComments(
    @Query() query: GetSocialCommentsQueryDto,
  ) {
    return this.dataCollectionService.getComments(query);
  }

  /**
   * Stops a running collection job.
   *
   * This operation remains Admin-only because CollectionJob
   * currently has no userId or createdById ownership field.
   *
   * Without job ownership, allowing a regular user to stop
   * a job could allow that user to stop another user's job.
   */
  @Post(':id/stop')
  @Roles(UserRole.ADMIN)
  stop(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.dataCollectionService.stop(id, admin.id);
  }
}
