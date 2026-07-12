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
 * DTO used by an administrator to adjust a user's credits.
 *
 * Positive values add credits.
 * Negative values deduct credits.
 *
 * @author Malak
 */
export class AdjustUserCreditsDto {
  /**
   * Target user identifier.
   */
  @IsUUID('4')
  userId!: string;

  /**
   * Signed non-zero credit adjustment.
   */
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  amount!: number;

  /**
   * Administrative reason for the adjustment.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  description!: string;
}