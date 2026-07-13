import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { UpsertIdeaFeedbackDto } from '../dto/upsert-idea-feedback.dto';

import { UserFeedbackService } from '../services/user-feedback.service';

/**
 * Handles authenticated-user idea-feedback endpoints.
 *
 * Base route:
 * /users
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserFeedbackController {
  constructor(private readonly userFeedbackService: UserFeedbackService) {}

  /**
   * Creates or updates feedback for one owned idea.
   *
   * POST /users/ideas/:id/feedback
   */
  @Post('ideas/:id/feedback')
  upsertFeedback(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,

    @Body() dto: UpsertIdeaFeedbackDto,
  ) {
    return this.userFeedbackService.upsertFeedback(user.id, ideaId, dto);
  }

  /**
   * Retrieves the user's feedback for one owned idea.
   *
   * GET /users/ideas/:id/feedback
   */
  @Get('ideas/:id/feedback')
  getFeedbackByIdea(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.userFeedbackService.getFeedbackByIdea(user.id, ideaId);
  }

  /**
   * Retrieves all feedback submitted by the authenticated user.
   *
   * GET /users/feedback
   */
  @Get('feedback')
  getMyFeedback(@CurrentUser() user: AuthenticatedUser) {
    return this.userFeedbackService.getMyFeedback(user.id);
  }
}
