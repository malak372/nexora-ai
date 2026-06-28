import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a new platform.
 *
 * This DTO is used with the POST /admin/platforms endpoint.
 * It defines the required and optional data needed to create
 * a new comment source platform.
 *
 * Validation Rules:
 * - Platform name must be a string with a minimum length of 2 characters.
 * - Platform active status is optional and must be a boolean if provided.
 *
 * Example:
 * {
 *   "name": "Reddit",
 *   "isActive": true
 * }
 *
 * @author Malak
 */
export class CreatePlatformDto {
  /**
   * The name of the platform.
   *
   * Must be a string containing at least two characters.
   *
   * Example:
   * Reddit
   */
  @IsString()
  @MinLength(2)
  name!: string;

  /**
   * Indicates whether the platform is active.
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