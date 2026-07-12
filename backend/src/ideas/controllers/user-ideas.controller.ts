import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { GetIdeaCommentsQueryDto } from '../dto/get-idea-comments-query.dto';

import { GetUserIdeasQueryDto } from '../dto/get-user-ideas-query.dto';

import { UserIdeasService } from '../services/user-ideas.service';

/**
 * Authenticated-user idea retrieval.
 *
 * @author Eman
 */
@Controller('users/ideas')
@UseGuards(JwtAuthGuard)
export class UserIdeasController {
  constructor(private readonly userIdeasService: UserIdeasService) {}

  @Get()
  getGeneratedIdeas(
    @CurrentUser()
    user: {
      id: string;
    },

    @Query()
    query: GetUserIdeasQueryDto,
  ) {
    return this.userIdeasService.getGeneratedIdeas(user.id, query);
  }

  /**
   * GET /users/ideas/:ideaId/comments
   */
  @Get(':ideaId/comments')
  getCollectedComments(
    @CurrentUser()
    user: {
      id: string;
    },

    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,

    @Query()
    query: GetIdeaCommentsQueryDto,
  ) {
    return this.userIdeasService.getCollectedComments(user.id, ideaId, query);
  }

  /**
   * GET /users/ideas/:ideaId
   */
  @Get(':ideaId')
  getGeneratedIdeaById(
    @CurrentUser()
    user: {
      id: string;
    },

    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.userIdeasService.getGeneratedIdeaById(user.id, ideaId);
  }
}
