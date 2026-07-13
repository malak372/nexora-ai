import { CreditTransactionType } from '@prisma/client';

import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by authenticated users to retrieve
 * their own credit transaction history.
 *
 * @author Eman
 */
export class GetUserCreditHistoryQueryDto extends ListQueryDto {
  /**
   * Optional transaction-type filter.
   */
  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: CreditTransactionType;
}
