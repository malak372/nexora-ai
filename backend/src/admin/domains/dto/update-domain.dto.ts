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
 * DTO for updating an existing software project domain.
 *
 * This DTO is used by the Admin module to update
 * an existing software project domain.
 *
 * Endpoint:
 * PATCH /admin/domains/:id
 *
 * Validation rules:
 * - All fields are optional.
 * - name must be a string when provided.
 * - name must contain at least 2 characters.
 * - name must not exceed 100 characters.
 * - isActive must be a boolean when provided.
 * - keywords must be an array of strings when provided.
 *
 * Notes:
 * - Only the provided fields will be updated.
 * - Omitting a field keeps its current value unchanged.
 *
 * Example:
 * {
 *   "name": "Healthcare",
 *   "isActive": false,
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
export class UpdateDomainDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Optional replacement for the domain keyword list.
   *
   * These keywords are used by data collectors to search
   * social platforms and community discussions for
   * domain-related problems and needs.
   *
   * Behavior:
   * - If omitted, the existing keywords remain unchanged.
   * - If provided as an empty array, all existing keywords are removed.
   * - If provided with values, the existing keyword list is completely replaced.
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
