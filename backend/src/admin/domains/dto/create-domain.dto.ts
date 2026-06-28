import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a new project domain.
 *
 * This DTO is used with the POST /admin/domains endpoint.
 * It defines the required and optional data needed to create
 * a new project domain that users can select during idea generation.
 *
 * Validation Rules:
 * - Domain name must be a string with a minimum length of 2 characters.
 * - Domain active status is optional and must be a boolean if provided.
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
   * The name of the project domain.
   *
   * Must be a string containing at least two characters.
   *
   * Example:
   * Healthcare
   */
  @IsString()
  @MinLength(2)
  name!: string;

  /**
   * Indicates whether the domain is active.
   *
   * If omitted, the default value defined in the database
   * will be used.
   *
   * Example:
   * true
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}