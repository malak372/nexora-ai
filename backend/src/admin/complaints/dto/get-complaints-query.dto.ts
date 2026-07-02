import { IsEnum, IsOptional } from 'class-validator';
import { ComplaintPriority, ComplaintStatus } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating user complaints.
 *
 * Used with:
 * GET /admin/complaints
 * GET /admin/complaints/summary
 * GET /admin/complaints/charts
 * GET /admin/complaints/export/csv
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search by subject, message, admin reply, user, or idea title.
 * - Filter by complaint status.
 * - Filter by complaint priority.
 *
 * @author Malak
 */
export class GetComplaintsQueryDto extends ListQueryDto {
  /**
   * Optional complaint status filter.
   *
   * Must be one of the values defined in ComplaintStatus enum.
   */
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  /**
   * Optional complaint priority filter.
   *
   * Must be one of the values defined in ComplaintPriority enum.
   */
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;
}