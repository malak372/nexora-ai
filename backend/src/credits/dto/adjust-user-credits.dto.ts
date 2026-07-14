import { Type } from 'class-transformer';

import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  NotEquals,
} from 'class-validator';

/**
 * Request DTO used by administrators to manually
 * adjust a user's credit balance.
 *
 * Positive amounts add credits.
 * Negative amounts deduct credits.
 *
 * @author Malak
 */
export class AdjustUserCreditsDto {
  /**
   * Identifier of the user whose credit balance
   * will be adjusted.
   */
  @IsUUID('4')
  userId!: string;

  /**
   * Signed credit adjustment amount.
   *
   * Positive values add credits.
   * Negative values deduct credits.
   * Zero is not allowed.
   */
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  amount!: number;

  /**
   * Administrative reason recorded in the
   * credit transaction history and audit log.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  description!: string;
}