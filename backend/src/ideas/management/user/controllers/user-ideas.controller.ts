import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../../auth/guards/jwt-auth.guard';

import { GetIdeaCommentsQueryDto } from '../dto/get-idea-comments-query.dto';
import { GetUserIdeasQueryDto } from '../dto/get-user-ideas-query.dto';

import { UserIdeasService } from '../services/user-ideas.service';

/**
 * Controller used by authenticated users to manage
 * their generated project ideas.
 *
 * Base route:
 * /users/ideas
 *
 * Responsibilities:
 * - List the authenticated user's ideas.
 * - Retrieve one user-owned idea.
 * - Retrieve community posts and comments for an unlocked idea.
 * - Soft-delete one user-owned idea.
 *
 * This controller never allows a user to retrieve or modify
 * an idea belonging to another user.
 *
 * @author Malak
 */
@Controller('users/ideas')
@UseGuards(JwtAuthGuard)
export class UserIdeasController {
  constructor(
    private readonly userIdeasService: UserIdeasService,
  ) {}

  /**
   * Retrieves ideas belonging to the authenticated user.
   *
   * GET /users/ideas
   */
  @Get()
  getMyIdeas(
    @CurrentUser('id') userId: string,
    @Query() query: GetUserIdeasQueryDto,
  ) {
    return this.userIdeasService.getMyIdeas(
      userId,
      query,
    );
  }

  /**
   * Retrieves one idea belonging to the authenticated user.
   *
   * GET /users/ideas/:ideaId
   */
  @Get(':ideaId')
  getMyIdeaById(
    @CurrentUser('id') userId: string,

    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.userIdeasService.getMyIdeaById(
      userId,
      ideaId,
    );
  }

  /**
   * Retrieves collected community posts and comments
   * associated with an unlocked user-owned idea.
   *
   * GET /users/ideas/:ideaId/comments
   */
  @Get(':ideaId/comments')
  getMyIdeaComments(
    @CurrentUser('id') userId: string,

    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,

    @Query() query: GetIdeaCommentsQueryDto,
  ) {
    return this.userIdeasService.getMyIdeaComments(
      userId,
      ideaId,
      query,
    );
  }

  /**
   * Soft-deletes one idea belonging to the authenticated user.
   *
   * The idea remains stored for auditing and data consistency,
   * but it is excluded from normal user and admin listings.
   *
   * DELETE /users/ideas/:ideaId
   */
  @Delete(':ideaId')
  deleteMyIdea(
    @CurrentUser('id') userId: string,

    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.userIdeasService.deleteMyIdea(
      userId,
      ideaId,
    );
  }
}