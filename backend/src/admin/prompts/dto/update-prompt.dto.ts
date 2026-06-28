import { IsString, MinLength } from 'class-validator';

/**
 * DTO for updating the AI idea generation prompt template.
 *
 * This DTO is used with the PATCH /admin/prompts endpoint.
 * It defines the data required to update the prompt template
 * used by the AI model when generating software project ideas.
 *
 * Validation Rules:
 * - The prompt template must be a string.
 * - The prompt template must contain at least 20 characters.
 *
 * Example:
 * {
 *   "ideaPromptTemplate": "Generate an innovative software project idea based on the selected domain, region, and collected community feedback."
 * }
 *
 * @author Malak
 */
export class UpdatePromptDto {
  /**
   * The prompt template used by the AI during
   * software project idea generation.
   *
   * Must be a string containing at least
   * 20 characters.
   */
  @IsString()
  @MinLength(20)
  ideaPromptTemplate!: string;
}