import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * DTO for updating an existing project domain.
 *
 * This DTO is used with the PATCH /admin/domains/:id endpoint.
 * It defines the optional fields that an administrator can modify
 * for an existing project domain.
 *
 * All properties are optional, allowing the admin to update
 * one or more fields without affecting the remaining data.
 *
 * Validation Rules:
 * - Domain name must be a string with a minimum length of 2 characters.
 * - Domain active status must be a boolean if provided.
 *
 * Example:
 * {
 *   "name": "Education",
 *   "isActive": false
 * }
 *
 * @author Malak
 */
export class UpdateDomainDto {
  /**
   * Updated project domain name.
   *
   * Must be a string containing at least two characters.
   *
   * Example:
   * Education
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  /**
   * Updated active status of the project domain.
   *
   * Indicates whether the domain is available
   * for users during project idea generation.
   *
   * Example:
   * false
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}