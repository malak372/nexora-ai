import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

import { PAYMENT_CURRENCY_CODES } from '../constants/payment.constants';

export class GetPaymentPricingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  creditsQuantity?: number;

  @IsOptional()
  @IsString()
  @IsIn([...PAYMENT_CURRENCY_CODES])
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  currency?: string;
}