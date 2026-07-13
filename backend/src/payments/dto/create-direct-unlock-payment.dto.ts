import { IsEnum, IsString, IsUrl, IsUUID } from 'class-validator';

import { PaymentMethod } from '@prisma/client';

/**
 * DTO used by an authenticated user to create
 * a direct payment for unlocking one free idea.
 *
 * Direct unlock:
 * - Does not purchase credits.
 * - Does not consume credits.
 * - Applies only to one eligible NORMAL_FREE idea.
 *
 * @author Eman
 */
export class CreateDirectUnlockPaymentDto {
  /**
   * Existing free idea to unlock.
   */
  @IsUUID('4')
  ideaId!: string;

  /**
   * User-facing payment method selected for checkout.
   */
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  /**
   * Frontend URL used after successful checkout.
   *
   * The redirect itself does not prove that payment succeeded.
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
