import { ComplaintPriority, ComplaintStatus } from '@prisma/client';

import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used to retrieve complaints belonging to the
 * authenticated user.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date filtering.
 * - Sorting.
 * - Status filtering.
 * - Priority filtering.
 *
 * @author Eman
 */
export class GetUserComplaintsQueryDto extends ListQueryDto {
  /**
   * Optional complaint-status filter.
   */
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  /**
   * Optional complaint-priority filter.
   */
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;
}
