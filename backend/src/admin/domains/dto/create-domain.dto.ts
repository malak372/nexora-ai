import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a new project domain.
 *
 * This DTO is used by the Admin module when creating
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
 *
 * Notes:
 * - Reports and charts should not be handled inside this DTO.
 * - Domain analytics such as most selected domains should be
 *   handled in the service/report layer using the Idea and Domain tables.
 *
 * Example:
 * {
 *   "name": "Healthcare",
 *   "isActive": true
 * }
 *
 * @author Malak
 */
export class CreateDomainDto {
  /**
   * Name of the software project domain.
   *
   * This value represents a selectable category for idea generation.
   *
   * Examples:
   * - Healthcare
   * - Education
   * - E-Commerce
   */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /**
   * Indicates whether the domain is active and available
   * for users during idea generation.
   *
   * If omitted, the database default value will be used.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}