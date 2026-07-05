import { IsEnum, IsOptional } from 'class-validator';
import { ComplaintPriority, ComplaintStatus } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving the authenticated user's complaints.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date range filtering.
 * - Sorting.
 * - Filtering by complaint status.
 * - Filtering by complaint priority.
 *
 * @author Eman
 */
export class GetUserComplaintsQueryDto extends ListQueryDto {
    /**
     * Optional complaint status filter.
     */
    @IsOptional()
    @IsEnum(ComplaintStatus)
    status?: ComplaintStatus;

    /**
     * Optional complaint priority filter.
     */
    @IsOptional()
    @IsEnum(ComplaintPriority)
    priority?: ComplaintPriority;
}