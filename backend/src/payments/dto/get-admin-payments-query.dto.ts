import { PaymentPurpose, PaymentStatus } from '@prisma/client';

import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve and analyze payments.
 *
 * Used by:
 * - Payment listing.
 * - Payment summary.
 * - Payment charts.
 * - CSV export.
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date filtering.
 * - Search by user name or email.
 * - Payment-status filtering.
 * - Payment-purpose filtering.
 * - Payment-method filtering.
 * - Payment-provider filtering.
 *
 * @author Malak
 */
export class GetAdminPaymentsQueryDto extends ListQueryDto {
  /**
   * Optional payment-status filter.
   */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /**
   * Optional payment-purpose filter.
   */
  @IsOptional()
  @IsEnum(PaymentPurpose)
  paymentPurpose?: PaymentPurpose;

  /**
   * Optional user-facing payment-method key filter.
   *
   * Examples:
   * - card
   * - paypal
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  paymentMethodKey?: string;

  /**
   * Optional backend payment-provider key filter.
   *
   * Examples:
   * - stripe
   * - paypal
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  providerKey?: string;
}