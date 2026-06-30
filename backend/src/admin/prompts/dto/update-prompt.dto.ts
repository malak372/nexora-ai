import { Transform } from 'class-transformer';
import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for updating the AI idea generation prompt template.
 *
 * Used with:
 * PATCH /admin/prompts
 *
 * Validation rules:
 * - ideaPromptTemplate is required.
 * - It is automatically trimmed before validation.
 * - It must be a string.
 * - It must contain at least 20 characters.
 * - It must not exceed 5000 characters.
 *
 * @author Malak
 */
export class UpdatePromptDto {
  /**
   * Prompt template used by the AI during software project idea generation.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  ideaPromptTemplate!: string;
}