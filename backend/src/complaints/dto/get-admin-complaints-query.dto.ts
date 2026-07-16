import {
  ComplaintPriority,
  ComplaintStatus,
} from '@prisma/client';

import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve and analyze complaints.
 *
 * Inherits common query options from ListQueryDto:
 * - Pagination.
 * - Search.
 * - Date-range filtering.
 * - Sorting.
 *
 * Adds complaint-specific filters:
 * - Complaint status.
 * - Complaint priority.
 *
 * Used by:
 * - GET /admin/complaints
 * - GET /admin/complaints/summary
 * - GET /admin/complaints/charts
 * - GET /admin/complaints/export/csv
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
