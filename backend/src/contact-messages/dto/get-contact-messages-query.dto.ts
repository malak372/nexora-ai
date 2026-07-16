import { ContactMessageStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve and analyze
 * Contact Us messages.
 *
 * Inherits common query options from ListQueryDto:
 * - Pagination.
 * - Search.
 * - Sorting.
 * - Date-range filtering.
 *
 * Adds contact-message-specific filtering by status.
 *
 * Used by:
 * - GET /admin/contact-messages
 * - GET /admin/contact-messages/summary
 * - GET /admin/contact-messages/charts
 * - GET /admin/contact-messages/export/csv
 *
 * @author Malak
 */
export class GetContactMessagesQueryDto extends ListQueryDto {
  /**
   * Optional contact-message status filter.
   */
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;
}
