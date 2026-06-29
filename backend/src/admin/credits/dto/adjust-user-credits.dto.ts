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
 * This DTO allows administrators to manually
 * add or deduct credits from a user's account.
 *
 * Validation Rules:
 * - userId must be a valid UUID.
 * - amount must be a non-zero integer.
 *   - Positive values add credits.
 *   - Negative values deduct credits.
 * - description must contain between 5 and 500 characters.
 *
 * Example:
 * {
 *   "userId": "c9d7b1a6-8d4e-4d15-b6a2-91f6d5f3a8b2",
 *   "amount": 10,
 *   "description": "Compensation for system issue"
 * }
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
   * Positive values add credits.
   * Negative values deduct credits.
   * Zero is not allowed.
   */
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