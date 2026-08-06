import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Partial update for the single global system-settings record.
 *
 * Prices are stored in USD and are intentionally configurable so the web and
 * mobile clients never hard-code commercial rules.
 *
 * @author Malak
 */
export class UpdateSystemSettingsDto {
  /** Price of one premium credit. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  creditPrice?: number;

  /** Credits consumed to generate one Premium idea. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  premiumIdeaCreditCost?: number;

  /** Direct-payment price for unlocking one user-owned free idea. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  directUnlockPrice?: number;

  /** Fee added when a NORMAL account transitions to PREMIUM. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  premiumActivationFee?: number;

  /** Fixed acceptance price for NORMAL accounts. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  normalAcceptancePrice?: number;


  /** Direct-payment price for a NORMAL user's advanced publication outputs. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  normalPublicationAdvancedPrice?: number;

  /** Credits a PREMIUM user spends to unlock advanced publication outputs. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  publicationAdvancedCreditCost?: number;

  /** Minimum purchased quantity required for bonus eligibility. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bonusThreshold?: number;

  /** Bonus credits awarded when the threshold is reached. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bonusCredits?: number;
}