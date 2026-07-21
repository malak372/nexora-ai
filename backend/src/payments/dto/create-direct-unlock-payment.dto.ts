import { IsString, IsUrl, IsUUID, Matches } from 'class-validator';

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
   * The redirect itself does not prove that payment succeeded.
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
