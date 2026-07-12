import { Type } from 'class-transformer';

import {
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

import {
  MAX_FEEDBACK_RATING,
  MIN_FEEDBACK_RATING,
} from '../constants/feedback.constants';

/**
 * Query DTO used by administrators to retrieve and analyze
 * idea feedback.
 *
 * Used by:
 * - Feedback listing.
 * - Feedback summary.
 * - Feedback charts.
 * - CSV export.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Sorting.
 * - Date filtering.
 * - Rating filtering.
 * - User filtering.
 * - Idea filtering.
 *
 * @author Malak
 */
export class GetFeedbackQueryDto extends ListQueryDto {
  /**
   * Optional rating filter.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FEEDBACK_RATING)
  @Max(MAX_FEEDBACK_RATING)
  rating?: number;

  /**
   * Optional user filter.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  /**
   * Optional idea filter.
   */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;
}