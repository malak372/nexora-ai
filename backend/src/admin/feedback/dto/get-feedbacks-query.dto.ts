import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating idea feedback.
 *
 * Used with:
 * GET /admin/feedback
 * GET /admin/feedback/summary
 * GET /admin/feedback/charts
 * GET /admin/feedback/export/csv
 *
 * @author Malak
 */
export class GetFeedbacksQueryDto extends ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  ideaId?: string;
}
