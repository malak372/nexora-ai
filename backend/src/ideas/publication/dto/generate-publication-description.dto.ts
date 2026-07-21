import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  DEFAULT_PUBLICATION_DESCRIPTION_MAX_WORDS,
  MAX_PUBLICATION_DESCRIPTION_WORDS,
  MIN_PUBLICATION_DESCRIPTION_WORDS,
  PUBLICATION_DESCRIPTION_LANGUAGES,
} from '../constants/idea-publication.constants';
import type { PublicationDescriptionLanguage } from '../types/idea-publication.type';

/**
 * Input used to generate a concise public-facing idea description.
 *
 * The generated description is returned as a suggestion and is not
 * published automatically. The owner can review, edit, and save it through
 * the normal publication upsert endpoint.
 *
 * @author Malak
 */
export class GeneratePublicationDescriptionDto {
  /**
   * Desired output language.
   */
  @IsOptional()
  @IsIn(PUBLICATION_DESCRIPTION_LANGUAGES)
  language?: PublicationDescriptionLanguage = 'EN';

  /**
   * Approximate maximum number of words in the generated description.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_PUBLICATION_DESCRIPTION_WORDS)
  @Max(MAX_PUBLICATION_DESCRIPTION_WORDS)
  maxWords?: number = DEFAULT_PUBLICATION_DESCRIPTION_MAX_WORDS;
}
