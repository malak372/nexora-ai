import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PAYMENT_CURRENCY_CODES } from '../../../payments/constants/payment.constants';

export class CreatePublicationAdvancedUnlockDto {
  @IsUUID('4')
  clientRequestId!: string;

  @IsString()
  @IsIn(['card'])
  @MaxLength(30)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  paymentMethodKey!: string;

  @IsOptional()
  @IsString()
  @IsIn([...PAYMENT_CURRENCY_CODES])
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  currency?: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  successUrl!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  cancelUrl!: string;
}