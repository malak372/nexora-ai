import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';

import { PAYMENT_CURRENCY_CODES } from '../constants/payment.constants';

export class CreateDirectUnlockPaymentDto {
  @IsUUID('4')
  ideaId!: string;

  @IsString()
  @IsIn(['card'])
  paymentMethodKey!: string;

  @IsOptional()
  @IsString()
  @IsIn([...PAYMENT_CURRENCY_CODES])
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  currency?: string;

  @IsUrl({
    require_protocol: true,
    require_tld: false,
  })
  successUrl!: string;

  @IsUrl({
    require_protocol: true,
    require_tld: false,
  })
  cancelUrl!: string;
}