import { IsEnum, IsOptional } from 'class-validator';
import { ComplaintStatus, ComplaintPriority } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering and paginating user complaints.
 *
 * This DTO is used with the GET /admin/complaints endpoint.
 * It defines the optional query parameters that an administrator
 * can use to filter and paginate submitted complaints.
 *
 * Supported features:
 * - Pagination.
 * - Filter by complaint status.
 * - Filter by complaint priority.
 *
 * All properties are optional, allowing the administrator
 * to retrieve all complaints or apply one or more filters.
 *
 * Example:
 * GET /admin/complaints?page=1&limit=10&status=OPEN&priority=HIGH
 *
 * @author Malak
 */
export class GetComplaintsQueryDto extends ListQueryDto {
  /**
   * Optional complaint status filter.
   *
   * Must be one of the values defined in the
   * ComplaintStatus enum.
   *
   * Example:
   * OPEN
   */
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  /**
   * Optional complaint priority filter.
   *
   * Must be one of the values defined in the
   * ComplaintPriority enum.
   *
   * Example:
   * HIGH
   */
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;
}