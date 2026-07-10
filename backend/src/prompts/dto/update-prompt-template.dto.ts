import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import {
  PROMPT_TEMPLATE_MAX_LENGTH,
  PROMPT_TEMPLATE_MIN_LENGTH,
} from '../constants/prompt.constants';

/**
 * DTO used by administrators to update the configurable
 * idea-generation prompt template.
 *
 * The template is provider-independent and may be used with
 * any supported AI provider.
 *
 * Placeholder validation is performed by PromptTemplateService.
 *
 * @author Malak
 */
export class UpdatePromptTemplateDto {
  /**
   * New configurable idea-generation prompt template.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(PROMPT_TEMPLATE_MIN_LENGTH)
  @MaxLength(PROMPT_TEMPLATE_MAX_LENGTH)
  ideaPromptTemplate!: string;
}
