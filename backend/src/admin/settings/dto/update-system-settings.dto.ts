import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

/**
 * DTO for updating system settings related to the credit system.
 *
 * This DTO is used by administrators to modify configurable
 * application settings such as:
 * - Credit price.
 * - Bonus eligibility threshold.
 * - Bonus credits awarded.
 *
 * All properties are optional, allowing the admin to update
 * one or more settings in a single request.
 *
 * Validation Rules:
 * - creditPrice must be a number greater than or equal to 0.
 * - bonusThreshold must be a non-negative integer.
 * - bonusCredits must be a non-negative integer.
 *
 * Example:
 * {
 *   "creditPrice": 15,
 *   "bonusThreshold": 10,
 *   "bonusCredits": 1
 * }
 *
 * @author Malak
 */
export class UpdateSystemSettingsDto {
  /**
   * The price of a single credit.
   *
   * Must be a number greater than or equal to zero.
   *
   * Example:
   * 15
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditPrice?: number;

  /**
   * Minimum number of purchased credits required
   * for a user to receive bonus credits.
   *
   * Must be a non-negative integer.
   *
   * Example:
   * 10
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bonusThreshold?: number;

  /**
   * Number of bonus credits awarded when the
   * bonus threshold is reached.
   *
   * Must be a non-negative integer.
   *
   * Example:
   * 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bonusCredits?: number;
}