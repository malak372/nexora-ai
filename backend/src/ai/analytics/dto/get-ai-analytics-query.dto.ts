import { ApiRequestType } from '@prisma/client';

import { Transform } from 'class-transformer';

import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import {
  SUPPORTED_AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../../constants/ai-provider.constants';

/**
 * Query DTO used to filter administrator-facing AI usage analytics.
 *
 * The provider key is validated against the providers implemented by
 * the current backend deployment.
 *
 * @author Malak
 */
export class GetAiAnalyticsQueryDto {
  /**
   * Inclusive beginning of the analytics period.
   *
   * Accepted values include:
   * - 2026-07-01
   * - 2026-07-01T10:30:00.000Z
   */
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  /**
   * Inclusive end of the analytics period.
   *
   * A date-only value is interpreted by the analytics service as the
   * end of that calendar day.
   */
  @IsOptional()
  @IsDateString()
  toDate?: string;

  /**
   * Optional backend provider-registry key.
   *
   * Examples:
   * - google
   * - openrouter
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsIn(SUPPORTED_AI_PROVIDER_KEYS)
  providerKey?: AiProviderKey;

  /**
   * Optional external AI request category.
   */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /**
   * Optional AI-model database identifier.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsUUID('4')
  aiModelId?: string;
}
