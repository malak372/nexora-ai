import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';

/**
 * Creates a direct-payment checkout for advanced publication outputs.
 *
 * This request is valid only when the authenticated NORMAL user already owns
 * the basic publication acceptance and advanced access is still locked.
 */
export class CreatePublicationAdvancedUnlockDto {
  /** Stable idempotency identifier generated once for this checkout action. */
  @IsUUID('4')
  clientRequestId!: string;

  /** User-facing payment method: card or paypal. */
  @IsString()
  @MaxLength(30)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  paymentMethodKey!: string;

  /** Provider return URL after a successful checkout. */
  @IsUrl({ require_tld: false, require_protocol: true })
  successUrl!: string;

  /** Provider return URL when checkout is cancelled. */
  @IsUrl({ require_tld: false, require_protocol: true })
  cancelUrl!: string;
}