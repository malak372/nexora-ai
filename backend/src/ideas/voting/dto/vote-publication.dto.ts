import { IdeaVoteValue } from '@prisma/client';

import { IsEnum } from 'class-validator';

/**
 * DTO used to submit a user's vote for a published idea.
 *
 * Each authenticated user can have only one vote per publication.
 * Submitting another vote replaces the previous vote value.
 *
 * @author Malak
 */
export class VotePublicationDto {
  /**
   * Vote value selected by the user.
   */
  @IsEnum(IdeaVoteValue)
  value!: IdeaVoteValue;
}
