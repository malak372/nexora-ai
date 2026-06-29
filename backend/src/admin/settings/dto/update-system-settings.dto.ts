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
 * Used with:
 * PATCH /admin/settings
 *
 * This DTO allows administrators to update configurable
 * credit system values.
 *
 * All properties are optional, allowing partial updates.
 *
 * @author Malak
 */
export class UpdateSystemSettingsDto {
  /**
   * Price of a single credit.
   *
   * Must be a number greater than or equal to 0.
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
   * for bonus eligibility.
   *
   * Must be a non-negative integer.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bonusThreshold?: number;

  /**
   * Number of bonus credits awarded when
   * the threshold is reached.
   *
   * Must be a non-negative integer.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bonusCredits?: number;
}