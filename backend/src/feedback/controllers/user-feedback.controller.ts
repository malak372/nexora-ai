import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { UpsertPublicationFeedbackDto } from '../dto/upsert-publication-feedback.dto';
import { UpsertPublicationRatingDto } from '../dto/upsert-publication-rating.dto';

import { UserFeedbackService } from '../services/user-feedback.service';

/**
 * Handles authenticated-user publication feedback
 * and rating endpoints.
 *
 * Base route:
 * /users/publications
 *
 * @author Eman
 */
@Controller('users/publications')
@UseGuards(JwtAuthGuard)
export class UserFeedbackController {
  constructor(private readonly userFeedbackService: UserFeedbackService) { }

  /**
   * Creates or updates the authenticated user's rating.
   *
   * PUT /users/publications/:publicationId/rating
   */
  @Put(':publicationId/rating')
  upsertRating(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,

    @Body() dto: UpsertPublicationRatingDto,
  ) {
    return this.userFeedbackService.upsertRating(
      user.id,
      publicationId,
      dto,
    );
  }

  /**
   * Returns the authenticated user's rating
   * for one publication.
   *
   * GET /users/publications/:publicationId/rating
   */
  @Get(':publicationId/rating')
  getMyRating(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
  ) {
    return this.userFeedbackService.getMyRating(
      user.id,
      publicationId,
    );
  }

  /**
   * Removes the authenticated user's rating.
   *
   * DELETE /users/publications/:publicationId/rating
   */
  @Delete(':publicationId/rating')
  deleteRating(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
  ) {
    return this.userFeedbackService.deleteRating(
      user.id,
      publicationId,
    );
  }

  /**
   * Creates or updates textual publication feedback.
   *
   * PUT /users/publications/:publicationId/feedback
   */
  @Put(':publicationId/feedback')
  upsertFeedback(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,

    @Body() dto: UpsertPublicationFeedbackDto,
  ) {
    return this.userFeedbackService.upsertFeedback(
      user.id,
      publicationId,
      dto,
    );
  }

  /**
   * Returns the authenticated user's textual feedback.
   *
   * GET /users/publications/:publicationId/feedback
   */
  @Get(':publicationId/feedback')
  getMyFeedback(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
  ) {
    return this.userFeedbackService.getMyFeedback(
      user.id,
      publicationId,
    );
  }

  /**
   * Removes the authenticated user's textual feedback.
   *
   * DELETE /users/publications/:publicationId/feedback
   */
  @Delete(':publicationId/feedback')
  deleteFeedback(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
  ) {
    return this.userFeedbackService.deleteFeedback(
      user.id,
      publicationId,
    );
  }
}