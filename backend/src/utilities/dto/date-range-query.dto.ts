import { IsDateString, IsOptional } from 'class-validator';

/**
 * DTO for filtering records by creation date range.
 *
 * This DTO provides optional date range filters that can be
 * reused across admin list endpoints.
 *
 * Supported filters:
 * - fromDate: Returns records created on or after this date.
 * - toDate: Returns records created on or before this date.
 *
 * Example:
 * GET /admin/payments?fromDate=2026-06-01&toDate=2026-06-30
 *
 * @author Malak
 */
export class DateRangeQueryDto {
    /**
     * Optional start date filter.
     *
     * Returns records created on or after this date.
     *
     * Example:
     * 2026-06-01
     */
    @IsOptional()
    @IsDateString()
    fromDate?: string;

    /**
     * Optional end date filter.
     *
     * Returns records created on or before this date.
     *
     * Example:
     * 2026-06-30
     */
    @IsOptional()
    @IsDateString()
    toDate?: string;
}