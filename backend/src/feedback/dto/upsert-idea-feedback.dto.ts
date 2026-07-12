import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  MAX_FEEDBACK_COMMENT_LENGTH,
  MAX_FEEDBACK_RATING,
  MIN_FEEDBACK_RATING,
} from '../constants/feedback.constants';

/**
 * DTO used by an authenticated user to create or update
 * feedback for one owned generated idea.
 *
 * Each user may have only one feedback record per idea.
 * Sending feedback again updates the existing record.
 *
 * @author Eman
 */
export class UpsertIdeaFeedbackDto {
  /**
   * Idea rating from 1 to 5.
   */
  @IsInt()
  @Min(MIN_FEEDBACK_RATING)
  @Max(MAX_FEEDBACK_RATING)
  rating!: number;

  /**
   * Optional feedback comment.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FEEDBACK_COMMENT_LENGTH)
  comment?: string;
}
