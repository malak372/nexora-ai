import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Filters collected social comments for administrative monitoring.
 *
 * @author Malak
 */
export class GetCommentsQueryDto extends ListQueryDto {
  /** Optional data-source identifier. */
  @IsOptional()
  @IsUUID()
  dataSourceId?: string;

  /** Optional source language code. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  /** Optional geographical region inherited from the parent post. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;
}
