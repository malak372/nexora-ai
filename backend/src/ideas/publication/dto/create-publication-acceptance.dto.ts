import { Transform, type TransformFnParams } from 'class-transformer';

import {
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Request used by a NORMAL user to create a paid
 * publication-acceptance checkout.
 *
 * Responsibilities:
 * - Preserve a stable client-generated idempotency identifier.
 * - Validate the selected payment method.
 * - Validate checkout redirect URLs.
 * - Accept optional location information associated with the acceptance.
 *
 * @author Malak
 */
export class CreatePublicationAcceptanceDto {
  /**
   * Stable idempotency key generated once by the client
   * for this acceptance action.
   */
  @IsUUID('4')
  clientRequestId!: string;

  /**
   * User-facing payment-method key.
   *
   * The value is normalized before validation and processing.
   */
  @IsString()
  @MaxLength(30)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  paymentMethodKey!: string;

  /**
   * URL used by the payment provider after a successful checkout.
   */
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  successUrl!: string;

  /**
   * URL used by the payment provider when checkout is cancelled.
   */
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  cancelUrl!: string;

  /**
   * Optional country associated with the publication acceptance.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  country?: string;

  /**
   * Optional city associated with the publication acceptance.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  city?: string;

  /**
   * Optional region associated with the publication acceptance.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  region?: string;
}
