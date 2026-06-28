import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for querying platforms.
 *
 * Supports pagination, date range filtering,
 * searching, sorting, and filtering by active status.
 *
 * @author Malak
 */
export class GetPlatformsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  isActive?: string;
}