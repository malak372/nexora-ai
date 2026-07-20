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

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

import { VotePublicationDto } from '../dto/vote-publication.dto';
import { IdeaVotingService } from '../services/idea-voting.service';

/**
 * Handles authenticated-user voting operations for idea publications.
 *
 * This controller allows a user to:
 * - Create or update their vote on a publication.
 * - Retrieve their current vote.
 * - Remove their vote.
 *
 * All endpoints require JWT authentication.
 *
 * The controller delegates publication-access validation, vote persistence,
 * and engagement-counter updates to {@link IdeaVotingService}.
 *
 * @author Malak
 */
@Controller('users/publications')
@UseGuards(JwtAuthGuard)
export class PublicationVotesController {
  constructor(
    private readonly votingService: IdeaVotingService,
  ) {}

  /**
   * Creates or updates the authenticated user's vote on a publication.
   *
   * A user can have only one vote per publication. When a vote already
   * exists, its value is replaced with the value supplied in the request.
   *
   * The related publication must:
   * - Exist.
   * - Be accessible to the authenticated user.
   * - Allow community voting.
   *
   * @param user Authenticated user extracted from the JWT.
   * @param publicationId Publication UUID.
   * @param dto Requested vote value.
   * @returns Created or updated vote and refreshed voting counters.
   */
  @Put(':publicationId/vote')
  upsertVote(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'publicationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    publicationId: string,
    @Body() dto: VotePublicationDto,
  ) {
    return this.votingService.upsertVote(
      user.id,
      publicationId,
      dto,
    );
  }

  /**
   * Retrieves the authenticated user's current vote on a publication.
   *
   * This endpoint returns the user's vote when it exists. The voting service
   * defines the response returned when the user has not voted yet.
   *
   * @param user Authenticated user extracted from the JWT.
   * @param publicationId Publication UUID.
   * @returns Current vote information for the authenticated user.
   */
  @Get(':publicationId/vote')
  getMyVote(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'publicationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    publicationId: string,
  ) {
    return this.votingService.getMyVote(
      user.id,
      publicationId,
    );
  }

  /**
   * Removes the authenticated user's vote from a publication.
   *
   * After deletion, the publication's upvote and downvote counters are
   * recalculated or updated by the voting service.
   *
   * @param user Authenticated user extracted from the JWT.
   * @param publicationId Publication UUID.
   * @returns Vote-deletion result and refreshed voting counters.
   */
  @Delete(':publicationId/vote')
  deleteVote(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'publicationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    publicationId: string,
  ) {
    return this.votingService.deleteVote(
      user.id,
      publicationId,
    );
  }
}
