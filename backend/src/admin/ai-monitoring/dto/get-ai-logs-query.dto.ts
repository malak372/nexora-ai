import { ApiRequestType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { AiProviderErrorCode } from '../../../ai/errors/ai-provider-error-code.enum';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Converts the textual true and false query values into booleans.
 *
 * Other values are preserved so class-validator can report invalid input
 * instead of silently coercing it.
 */
function transformBooleanQueryValue({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'true') {
    return true;
  }

  if (normalizedValue === 'false') {
    return false;
  }

  return value;
}

/**
 * Filters administrator AI-monitoring logs.
 *
 * Supported diagnostics include:
 * - Provider and external model identifiers.
 * - Logical operation and model-attempt identifiers.
 * - Request type and success state.
 * - Provider-independent failure category.
 * - Retry and fallback decisions.
 *
 * @author Malak
 */
export class GetAiLogsQueryDto extends ListQueryDto {
  /** Stable provider-registry key, such as google or openrouter. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  providerKey?: string;

  /** Exact database AI-model identifier. */
  @IsOptional()
  @IsUUID()
  aiModelId?: string;

  /** Exact provider-side model slug or model name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  apiModelId?: string;

  /** Logical AI operation shared by retries and fallback attempts. */
  @IsOptional()
  @IsUUID()
  operationId?: string;

  /** Business-level AI request category. */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /** Provider-independent normalized failure category. */
  @IsOptional()
  @IsEnum(AiProviderErrorCode)
  errorCode?: AiProviderErrorCode;

  /** Filters successful or failed individual provider requests. */
  @IsOptional()
  @Transform(transformBooleanQueryValue)
  @IsBoolean()
  isSuccess?: boolean;

  /** Filters failures according to same-model retry eligibility. */
  @IsOptional()
  @Transform(transformBooleanQueryValue)
  @IsBoolean()
  isRetryable?: boolean;

  /** Filters attempts that were executed after model/provider fallback. */
  @IsOptional()
  @Transform(transformBooleanQueryValue)
  @IsBoolean()
  fallbackUsed?: boolean;
}