import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { DataCollectionService } from './data-collection.service';
import { RunCollectionDto } from './dto/run-collection.dto';
import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';
import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';
import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Controller for admin data collection endpoints.
 *
 * Base route:
 * /data-collection
 *
 * Available endpoints:
 * - POST /data-collection/run
 * - GET /data-collection/status
 * - GET /data-collection/jobs
 * - GET /data-collection/posts
 * - GET /data-collection/comments
 * - POST /data-collection/:id/stop
 *
 * @author Malak
 */
@Controller('data-collection')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DataCollectionController {
  constructor(private readonly dataCollectionService: DataCollectionService) { }

  /**
   * Starts a new data collection job.
   */
  @Post('run')
  run(
    @Body() dto: RunCollectionDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.dataCollectionService.run(dto, admin.id);
  }

  /**
   * Returns collection jobs summary status.
   */
  @Get('status')
  getStatus() {
    return this.dataCollectionService.getStatus();
  }

  /**
   * Returns paginated collection jobs.
   */
  @Get('jobs')
  getJobs(@Query() query: GetCollectionJobsQueryDto) {
    return this.dataCollectionService.getJobs(query);
  }

  /**
   * Returns paginated collected social posts.
   */
  @Get('posts')
  getPosts(@Query() query: GetSocialPostsQueryDto) {
    return this.dataCollectionService.getPosts(query);
  }

  /**
   * Returns paginated collected social comments.
   */
  @Get('comments')
  getComments(@Query() query: GetSocialCommentsQueryDto) {
    return this.dataCollectionService.getComments(query);
  }

  /**
   * Stops a running collection job.
   */
  @Post(':id/stop')
  stop(
    @Param('id') id: string,
    @CurrentUser() admin: { id: string },
  ) {
    return this.dataCollectionService.stop(id, admin.id);
  }

  /**
   * Returns detailed information about one collection job.
   */
  @Get('jobs/:id')
  getJobDetails(@Param('id') id: string) {
    return this.dataCollectionService.getJobDetails(id);
  }
}