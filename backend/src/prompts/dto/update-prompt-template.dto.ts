import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import {
  PROMPT_TEMPLATE_MAX_LENGTH,
  PROMPT_TEMPLATE_MIN_LENGTH,
} from '../constants/prompt.constants';
import { Transform } from 'class-transformer';

/**
 * DTO used by Admin to update the AI idea prompt template.
 *
 * The template is stored in system settings and later rendered by
 * PromptTemplateService when building prompts for OpenAI.
 *
 * Required placeholders:
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
 * - {{dataQuality}}
 * - {{samplePosts}}
 * - {{sampleComments}}
 * - {{existingIdea}}
 * - {{requestedOutputFormat}}
 *
 * @author Malak
 */
export class UpdatePromptTemplateDto {
  /**
   * New AI idea prompt template configured by Admin.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(PROMPT_TEMPLATE_MIN_LENGTH)
  @MaxLength(PROMPT_TEMPLATE_MAX_LENGTH)
  ideaPromptTemplate!: string;
}