import { IsIn, IsString, IsUrl, IsUUID, Matches } from 'class-validator';

/**
 * DTO used by an authenticated user to create
 * a direct payment for unlocking one eligible free idea.
 *
 * Direct unlock:
 * - Does not purchase credits.
 * - Does not consume credits.
 * - Applies only to one eligible idea.
 *
 * @author Eman
 */
export class CreateDirectUnlockPaymentDto {
  /**
   * Existing eligible idea to unlock.
   */
  @IsUUID('4')
  ideaId!: string;

  /**
   * User-facing payment-method registry key.
   *
   * Supported value:
   * - card (Stripe Checkout)
   */
  @IsString()
  @IsIn(['card'])
  paymentMethodKey!: string;

  /**
   * Frontend URL used after successful checkout.
   *
   * The redirect itself does not prove that payment succeeded.
   */
  @IsUrl({
    require_protocol: true,
    require_tld: false,
  })
  successUrl!: string;

  /**
   * Frontend URL used when checkout is cancelled.
   */
  @IsUrl({
    require_protocol: true,
    require_tld: false,
  })
  cancelUrl!: string;
}