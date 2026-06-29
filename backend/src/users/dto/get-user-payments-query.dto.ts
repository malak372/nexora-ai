import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving the authenticated user's payment history.
 *
 * Extends the shared list query DTO to support:
 * - Pagination
 * - Date range filtering
 * - Search
 * - Sorting
 *
 * Additional filters:
 * - Payment status
 * - Payment method
 * - Payment purpose
 *
 * @author Eman
 */
export class GetUserPaymentsQueryDto extends ListQueryDto {
    /**
     * Optional payment status filter.
     */
    @IsOptional()
    @IsString()
    status?: string;

    /**
     * Optional payment method filter.
     */
    @IsOptional()
    @IsString()
    paymentMethod?: string;

    /**
     * Optional payment purpose filter.
     */
    @IsOptional()
    @IsString()
    paymentPurpose?: string;
}