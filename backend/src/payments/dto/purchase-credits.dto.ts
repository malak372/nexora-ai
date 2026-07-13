import { Type } from 'class-transformer';

import { IsEnum, IsInt, IsString, IsUrl, Max, Min } from 'class-validator';

import { PaymentMethod } from '@prisma/client';

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
   * User-facing payment method selected for checkout.
   */
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  /**
   * Frontend URL used after successful checkout.
   *
   * This redirect is not treated as proof of payment.
   * Final payment confirmation occurs only through
   * a verified provider webhook.
   */
  @IsString()
  @IsUrl({
    require_protocol: true,
  })
  successUrl!: string;

  /**
   * Frontend URL used when checkout is cancelled.
   */
  @IsString()
  @IsUrl({
    require_protocol: true,
  })
  cancelUrl!: string;
}
