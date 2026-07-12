import { ContactMessageStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve and analyze
 * contact messages.
 *
 * Used by:
 * - Message listing.
 * - Summary statistics.
 * - Chart analytics.
 * - CSV export.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Sorting.
 * - Date filtering.
 * - Status filtering.
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
