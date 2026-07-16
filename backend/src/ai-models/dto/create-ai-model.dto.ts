import { Transform, Type } from 'class-transformer';

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  SUPPORTED_AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../../ai/constants/ai-provider.constants';

/**
 * DTO used by administrators to create an AI-model configuration.
 *
 * Only providers that have registered backend adapters may be used.
 *
 * Models are always created as non-default. Default-model selection
 * is performed through a dedicated administrator endpoint.
 *
 * @author Malak
 */
export class CreateAiModelDto {
  /**
   * Stable backend provider-registry key.
   *
   * Supported values:
   * - google
   * - openrouter
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsIn(SUPPORTED_AI_PROVIDER_KEYS)
  providerKey!: AiProviderKey;

  /**
   * Internal administrative model name.
   *
   * This name is used by administrators and does not have to match
   * the provider-side model identifier.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  modelName!: string;

  /**
   * Exact model identifier sent to the external provider.
   *
   * Examples:
   * - gemini-2.5-flash
   * - openai/gpt-4.1-mini
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  apiModelId!: string;

  /**
   * Optional administrator-facing display name.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  displayName?: string;

  /**
   * Optional administrator-facing model description.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * Fallback priority.
   *
   * Higher values are preferred before lower values.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  /**
   * Weight used by BALANCED routing.
   *
   * Higher values increase the probability that the model is chosen
   * earlier in the weighted execution order.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  weight?: number;

  /**
   * Maximum number of output tokens that may be requested from this
   * model.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxOutputTokens?: number;

  /**
   * Whether the model supports provider-native JSON generation.
   *
   * Runtime schema validation remains required even when this value is
   * true.
   */
  @IsOptional()
  @IsBoolean()
  supportsJsonOutput?: boolean;

  /**
   * Whether the model supports provider tool or function calls.
   */
  @IsOptional()
  @IsBoolean()
  supportsTools?: boolean;

  /**
   * Whether the model supports image or vision input.
   */
  @IsOptional()
  @IsBoolean()
  supportsVision?: boolean;

  /**
   * Optional total model context-window size.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  contextWindow?: number;

  /**
   * Cost per one million provider input tokens.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({
    allowInfinity: false,
    allowNaN: false,
    maxDecimalPlaces: 6,
  })
  @Min(0)
  inputCostPerMillion?: number;

  /**
   * Cost per one million provider output tokens.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({
    allowInfinity: false,
    allowNaN: false,
    maxDecimalPlaces: 6,
  })
  @Min(0)
  outputCostPerMillion?: number;

  /**
   * Initial active state.
   *
   * Models are active by default, but they are never automatically
   * created as the default model.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
