import { Type } from 'class-transformer';

import { IsInt, IsString, IsUrl, Matches, Max, Min } from 'class-validator';

import {
  MAX_CREDITS_PER_PURCHASE,
  MIN_CREDITS_PER_PURCHASE,
} from '../constants/payment.constants';

/**
 * DTO used by an authenticated user to purchase
 * premium idea-generation credits.
 *
 * One credit allows one premium idea generation.
 *
 * @author Eman
 */
export class PurchaseCreditsDto {
  /**
   * Number of credits requested by the user.
   */
  @Type(() => Number)
  @IsInt()
  @Min(MIN_CREDITS_PER_PURCHASE)
  @Max(MAX_CREDITS_PER_PURCHASE)
  creditsQuantity!: number;

  /**
   * User-facing payment-method registry key.
   *
   * Examples:
   * - card
   * - paypal
   */
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  paymentMethodKey!: string;

  /**
   * Frontend URL used after successful checkout.
   *
   * This redirect is not treated as proof of payment.
   * Final payment confirmation occurs only through
   * a verified provider webhook.
   */
  @IsUrl({
    require_protocol: true,
  })
  successUrl!: string;

  /**
   * Frontend URL used when checkout is cancelled.
   */
  @IsUrl({
    require_protocol: true,
  })
  cancelUrl!: string;
}
