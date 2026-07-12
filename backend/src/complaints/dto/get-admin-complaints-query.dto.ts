import {
  ComplaintPriority,
  ComplaintStatus,
} from '@prisma/client';

import {
  IsEnum,
  IsOptional,
} from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve and analyze complaints.
 *
 * Used by:
 * - Complaint list.
 * - Complaint summary.
 * - Complaint charts.
 * - CSV export.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date filtering.
 * - Sorting.
 * - Status filtering.
 * - Priority filtering.
 *
 * @author Malak
 */
export class GetAdminComplaintsQueryDto extends ListQueryDto {
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