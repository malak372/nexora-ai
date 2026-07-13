import { Type } from 'class-transformer';

import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Pagination for collected comments belonging to an unlocked idea.
 *
 * @author Malak
 */
export class GetIdeaCommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
