import { AiProviderType, ApiRequestType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * Query DTO used to filter AI usage analytics.
 *
 * @author Malak
 */
export class GetAiAnalyticsQueryDto {
  /**
   * Inclusive beginning of the analytics range.
   */
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  /**
   * Inclusive end of the analytics range.
   */
  @IsOptional()
  @IsDateString()
  toDate?: string;

  /**
   * Optional AI-provider filter.
   */
  @IsOptional()
  @IsEnum(AiProviderType)
  provider?: AiProviderType;

  /**
   * Optional external request-type filter.
   */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /**
   * Optional AI-model identifier filter.
   */
  @IsOptional()
  @IsUUID('4')
  aiModelId?: string;
}
