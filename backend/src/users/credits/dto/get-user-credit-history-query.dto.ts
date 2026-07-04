import { IsEnum, IsOptional } from 'class-validator';
import { CreditTransactionType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving the authenticated user's credit transaction history.
 *
 * Extends the shared list query DTO to support:
 * - Pagination
 * - Date range filtering
 * - Search
 * - Sorting
 *
 * Additional filters:
 * - Transaction type
 *
 * @author Eman
 */
export class GetUserCreditHistoryQueryDto extends ListQueryDto {
    /**
     * Optional credit transaction type filter.
     */
    @IsOptional()
    @IsEnum(CreditTransactionType)
    type?: CreditTransactionType;
}