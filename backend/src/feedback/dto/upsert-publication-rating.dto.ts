import { IsInt, Max, Min } from 'class-validator';

import {
  MAX_FEEDBACK_RATING,
  MIN_FEEDBACK_RATING,
} from '../constants/feedback.constants';

/**
 * DTO used to create or update a publication rating.
 *
 * Each authenticated user may submit only one rating
 * per publication.
 *
 * Submitting another rating updates the previous value.
 *
 * @author Eman
 */
export class UpsertPublicationRatingDto {
  /**
   * Rating value between 1 and 5.
   */
  @IsInt()
  @Min(MIN_FEEDBACK_RATING)
  @Max(MAX_FEEDBACK_RATING)
  value!: number;
}
