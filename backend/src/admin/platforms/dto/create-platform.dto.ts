import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a new supported platform.
 *
 * Used with:
 * POST /admin/platforms
 *
 * Platforms represent comment/post sources used during
 * community feedback collection, such as Reddit or Facebook.
 *
 * @author Malak
 */
export class CreatePlatformDto {
  /**
   * Platform name.
   *
   * Must contain between 2 and 100 characters.
   *
   * Example:
   * Reddit
   */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /**
   * Indicates whether the platform is active and available
   * for data collection and idea generation.
   *
   * If omitted, the service uses true by default.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
