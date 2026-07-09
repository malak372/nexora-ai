import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO used by Admin to update the AI idea prompt template.
 *
 * Supported placeholders:
 * - {{domain}}
 * - {{country}}
 * - {{city}}
 * - {{region}}
 * - {{platforms}}
 * - {{commentsCount}}
 * - {{sentimentStats}}
 * - {{keywords}}
 * - {{topics}}
 * - {{recurringProblems}}
 * - {{extractedNeeds}}
 * - {{featureRequests}}
 * - {{opportunities}}
 * - {{insights}}
 * - {{samplePosts}}
 * - {{sampleComments}}
 * - {{existingIdea}}
 * - {{requestedOutputFormat}}
 *
 * @author Malak
 */
export class UpdatePromptTemplateDto {
  /**
   * New prompt template.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(15000)
  ideaPromptTemplate!: string;
}