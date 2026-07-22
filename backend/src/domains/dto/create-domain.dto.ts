import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DomainKeywordDto } from './domain-keyword.dto';
import { Type } from 'class-transformer';

/**
 * DTO for creating a new software project domain.
 *
 * This DTO is used by the Admin module to create
 * a new software project domain.
 *
 * Domains are displayed to users during idea generation,
 * allowing them to select the software field they want
 * the generated project idea to belong to.
 *
 * Endpoint:
 * POST /admin/domains
 *
 * Validation rules:
 * - name is required.
 * - name must be a string.
 * - name must contain at least 2 characters.
 * - name must not exceed 100 characters.
 * - isActive is optional.
 * - isActive must be a boolean when provided.
 * - keywords are optional.
 * - keywords must be an array of strings when provided.
 *
 * Notes:
 * - Reports and charts should not be handled inside this DTO.
 * - Domain analytics, such as the most selected domains,
 *   should be handled in the service/report layer using
 *   the Idea and Domain tables.
 *
 * Example:
 * {
 *   "name": "Healthcare",
 *   "isActive": true,
 *   "keywords": [
 *     "hospital",
 *     "doctor",
 *     "patient",
 *     "clinic"
 *   ]
 * }
 *
 * @author Malak
 */
export class CreateDomainDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Optional discovery keywords associated with this domain.
   *
   * These keywords are used by data collectors to search
   * social platforms and community discussions for
   * domain-related problems and needs.
   *
   * Example:
   * ["student", "school", "teacher", "learning"]
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomainKeywordDto)
  keywords?: DomainKeywordDto[];
}
