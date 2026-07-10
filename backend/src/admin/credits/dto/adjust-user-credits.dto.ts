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
 * DTO for adjusting a user's credit balance.
 *
 * Used with:
 * POST /admin/credits/adjust
 *
 * Positive amount adds credits.
 * Negative amount deducts credits.
 *
 * @author Malak
 */
export class AdjustUserCreditsDto {
  /**
   * Target user identifier.
   */
  @IsUUID()
  userId!: string;

  /**
   * Credit adjustment amount.
   *
   * Must be a non-zero integer.
   */
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  amount!: number;

  /**
   * Reason for the credit adjustment.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  description!: string;
}
