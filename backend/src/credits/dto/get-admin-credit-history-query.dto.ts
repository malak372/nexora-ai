import { CreditTransactionType } from '@prisma/client';

import {
  IsEnum,
  IsOptional,
} from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve
 * credit transaction history and analytics.
 *
 * @author Malak
 */
export class GetAdminCreditHistoryQueryDto extends ListQueryDto {
  /**
   * Optional credit-transaction type filter.
   */
  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: CreditTransactionType;
}