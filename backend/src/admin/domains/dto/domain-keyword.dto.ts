import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { LanguageCode } from '@prisma/client';

/**
 * Data Transfer Object (DTO) representing a single domain keyword.
 *
 * This DTO is used when creating or updating software project domains
 * through the Admin module.
 *
 * Each keyword helps classify a domain and improves domain matching
 * during idea generation.
 *
 * Validation rules:
 * - keyword is required.
 * - keyword must be a string.
 * - keyword length must be between 2 and 100 characters.
 * - language is required.
 * - language must be a valid LanguageCode enum value.
 *
 * Example:
 * {
 *   "keyword": "Artificial Intelligence",
 *   "language": "EN"
 * }
 *
 * @author Malak
 */
export class DomainKeywordDto {
  /**
   * Keyword associated with the software project domain.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  keyword!: string;

  /**
   * Language of the keyword.
   */
  @IsEnum(LanguageCode)
  language!: LanguageCode;
}
