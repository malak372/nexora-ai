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
 * This DTO defines the data required to update the prompt template
 * used by the AI model when generating software project ideas.
 *
 * Validation rules:
 * - ideaPromptTemplate is required.
 * - ideaPromptTemplate must be a string.
 * - ideaPromptTemplate must contain at least 20 characters.
 * - ideaPromptTemplate must not exceed 5000 characters.
 *
 * @author Malak
 */
export class UpdatePromptDto {
  /**
   * Prompt template used by the AI during software project idea generation.
   */
  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  ideaPromptTemplate!: string;
}