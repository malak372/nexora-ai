import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO used to update the system's AI idea generation prompt template.
 *
 * The template is stored in the system settings and is used by the
 * Prompt Builder service as the base prompt when generating software
 * project ideas.
 *
 * @author Malak
 */
export class UpdatePromptTemplateDto {
  /**
   * AI prompt template used for idea generation.
   *
   * Supports placeholders that are replaced dynamically by the
   * Prompt Builder before sending the prompt to the AI model.
   *
   * Maximum length: 15,000 characters.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(15000)
  ideaPromptTemplate!: string;
}