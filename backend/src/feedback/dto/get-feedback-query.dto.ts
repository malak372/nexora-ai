import { Type } from 'class-transformer';

import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { PublicationFeedbackStatus } from '@prisma/client';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

import {
  MAX_FEEDBACK_RATING,
  MIN_FEEDBACK_RATING,
} from '../constants/feedback.constants';

/**
 * Query DTO used by administrators to retrieve
 * publication feedback and rating analytics.
 *
 * @author Malak
 */
export class GetFeedbackQueryDto extends ListQueryDto {
  /**
   * Optional rating-value filter.
   *
   * Used by rating analytics and rating listings.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FEEDBACK_RATING)
  @Max(MAX_FEEDBACK_RATING)
  rating?: number;

  /**
   * Optional feedback-status filter.
   *
   * Used by textual-feedback listings.
   */
  @IsOptional()
  @IsEnum(PublicationFeedbackStatus)
  status?: PublicationFeedbackStatus;

  /**
   * Optional user filter.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  /**
   * Optional publication filter.
   */
  @IsOptional()
  @IsUUID('4')
  publicationId?: string;

  /**
   * Optional original-idea filter.
   */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;
}
