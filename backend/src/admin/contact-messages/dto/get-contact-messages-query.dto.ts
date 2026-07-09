import { IsEnum, IsOptional } from 'class-validator';
import { ContactMessageStatus } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating contact messages.
 *
 * Used with:
 * GET /admin/contact-messages
 * GET /admin/contact-messages/summary
 * GET /admin/contact-messages/charts
 * GET /admin/contact-messages/export/csv
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search by full name, email, subject, message, or admin reply.
 * - Filter by contact message status.
 *
 * @author Malak
 */
export class GetContactMessagesQueryDto extends ListQueryDto {
  /**
   * Optional contact message status filter.
   *
   * Must be one of the values defined in ContactMessageStatus enum.
   */
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;
}