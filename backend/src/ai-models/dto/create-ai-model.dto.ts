import { AiProviderType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO used by administrators to create an AI model.
 *
 * The model is created as non-default.
 * Default selection is handled through a dedicated endpoint.
 *
 * @author Malak
 */
export class CreateAiModelDto {
  /**
   * AI provider associated with the model.
   *
   * Example:
   * OPENAI
   */
  @IsEnum(AiProviderType)
  provider!: AiProviderType;

  /**
   * Internal model name used inside Nexora AI.
   *
   * Example:
   * GPT-5 Main
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  modelName!: string;

  /**
   * Exact provider API identifier.
   *
   * Example:
   * gpt-5
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  apiModelId!: string;

  /**
   * Optional human-readable dashboard name.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  /**
   * Optional model description.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * Optional fallback priority.
   *
   * Higher values may be used first in future fallback logic.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  /**
   * Optional active state.
   *
   * Defaults to true.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}