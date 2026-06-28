import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for querying domains.
 *
 * Supports pagination, date range filtering,
 * searching, sorting, and filtering by active status.
 *
 * @author Malak
 */
export class GetDomainsQueryDto extends ListQueryDto {
  /**
   * Optional active status filter.
   *
   * Accepted values:
   * - "true"
   * - "false"
   */
  @IsOptional()
  @IsString()
  isActive?: string;
}