import { AiProviderType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO used by administrators to create an AI model.
 *
 * Models are always created as non-default.
 * Default selection is handled through a dedicated endpoint.
 *
 * Operational health fields are intentionally not exposed because
 * they are managed internally by AiModelHealthService.
 *
 * @author Malak
 */
export class CreateAiModelDto {
  /**
   * AI provider associated with the model.
   *
   * Supported values:
   * - OPENAI
   * - ANTHROPIC
   * - GOOGLE
   */
  @IsEnum(AiProviderType)
  provider!: AiProviderType;

  /**
   * Internal administrative model name.
   *
   * This name is used inside the Nexora AI dashboard.
   *
   * Example:
   * GPT Main Model
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  modelName!: string;

  /**
   * Exact model identifier sent to the provider API.
   *
   * Examples:
   * - gpt-5
   * - claude-sonnet-4
   * - gemini-2.5-pro
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  apiModelId!: string;

  /**
   * Optional human-readable dashboard name.
   *
   * Empty or whitespace-only values are stored as null.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  displayName?: string;

  /**
   * Optional description of the model and its intended use.
   *
   * Empty or whitespace-only values are stored as null.
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
   * Higher values are preferred before lower values when
   * the default routing strategy is used.
   *
   * Defaults to 0.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  /**
   * Relative routing weight.
   *
   * Used by the BALANCED routing strategy.
   * Models with higher weights are more likely to be selected first.
   *
   * Defaults to 1.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  weight?: number;

  /**
   * Maximum output tokens allowed for one provider request.
   *
   * Defaults to 2048.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxOutputTokens?: number;

  /**
   * Provider price per one million input tokens.
   *
   * The value supports up to six decimal places.
   *
   * Defaults to 0.
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
   * Provider price per one million output tokens.
   *
   * The value supports up to six decimal places.
   *
   * Defaults to 0.
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
   * This property is allowed only during model creation.
   * Later activation and deactivation use dedicated endpoints.
   *
   * Defaults to true.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
