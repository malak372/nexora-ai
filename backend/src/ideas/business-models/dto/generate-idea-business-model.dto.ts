import { IsUUID } from 'class-validator';

/**
 * Request used to generate a new business-model version for
 * an already completed and unlocked idea.
 *
 * Selecting another template later creates a new version and
 * preserves all previously generated versions.
 *
 * @author Malak
 */
export class GenerateIdeaBusinessModelDto {
  /**
   * Active business-model template selected by the idea owner.
   */
  @IsUUID('4')
  businessModelTemplateId!: string;
}
