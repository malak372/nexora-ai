import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

import {
  MIN_CREDITS_PER_PURCHASE,
  PAYMENT_CURRENCY_CODES,
} from '../constants/payment.constants';

export class PurchaseCreditsDto {
  @Type(() => Number)
  @IsInt()
  @Min(MIN_CREDITS_PER_PURCHASE)
  creditsQuantity!: number;

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