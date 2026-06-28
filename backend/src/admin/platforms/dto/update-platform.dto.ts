import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * DTO for updating an existing platform.
 *
 * This DTO is used with the PATCH /admin/platforms/:id endpoint.
 * It defines the optional fields that an administrator can modify
 * for an existing platform.
 *
 * All properties are optional, allowing the admin to update
 * one or more fields without affecting the remaining data.
 *
 * Validation Rules:
 * - Platform name must be a string with a minimum length of 2 characters.
 * - Platform active status must be a boolean if provided.
 *
 * Example:
 * {
 *   "name": "Facebook",
 *   "isActive": false
 * }
 *
 * @author Malak
 */
export class UpdatePlatformDto {
  /**
   * Updated platform name.
   *
   * Must be a string containing at least two characters.
   *
   * Example:
   * Facebook
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  /**
   * Updated platform active status.
   *
   * Indicates whether the platform is enabled
   * for collecting comments.
   *
   * Example:
   * false
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}