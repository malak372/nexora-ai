import { IsInt, IsString, IsUUID, MinLength, NotEquals } from 'class-validator';

/**
 * DTO for adjusting a user's credit balance.
 *
 * This DTO is used by administrators to manually
 * add or deduct credits from a user's account.
 *
 * Validation Rules:
 * - userId must be a valid string representing the target user.
 * - amount must be a non-zero integer.
 *   - Positive values add credits.
 *   - Negative values deduct credits.
 * - description must be a string with a minimum length
 *   of 5 characters to record the reason for the adjustment.
 *
 * Example:
 * {
 *   "userId": "c9d7b1a6-8d4e-4d15-b6a2-91f6d5f3a8b2",
 *   "amount": 10,
 *   "description": "Compensation for system issue"
 * }
 *
 * Example (Deduction):
 * {
 *   "userId": "c9d7b1a6-8d4e-4d15-b6a2-91f6d5f3a8b2",
 *   "amount": -2,
 *   "description": "Correction of credit balance"
 * }
 * @author Malak
 */
export class AdjustUserCreditsDto {
  @IsUUID()
  userId!: string;

  @IsInt()
  @NotEquals(0)
  amount!: number;

  @IsString()
  @MinLength(5)
  description!: string;
}