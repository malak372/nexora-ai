import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by administrators to create a data-source record.
 *
 * The implementation state is intentionally excluded because
 * it is determined by the backend collector registry.
 *
 * @author Malak
 */
export class CreateDataSourceDto {
  /**
   * Stable backend registry key.
   *
   * Examples:
   * - youtube
   * - github
   * - dev-to
   * - google-play
   * - hacker-news
   *
   * The value must match SocialCollector.sourceKey exactly.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'key must contain lowercase letters, numbers, and single hyphens only.',
  })
  key!: string;

  /**
   * Human-readable source name.
   *
   * Example:
   * YouTube
   */
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName!: string;

  /**
   * Optional explanation displayed to administrators or users.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /**
   * Determines whether the source can be selected.
   *
   * Activation is rejected when no implemented collector
   * exists for the supplied key.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Indicates that the source returns post-like records.
   */
  @IsOptional()
  @IsBoolean()
  supportsPosts?: boolean;

  /**
   * Indicates that the source returns comments or reviews.
   */
  @IsOptional()
  @IsBoolean()
  supportsComments?: boolean;

  /**
   * Indicates that the external source supports real
   * geographical filtering.
   */
  @IsOptional()
  @IsBoolean()
  supportsRegion?: boolean;

  /**
   * Indicates that the external source supports language filtering.
   */
  @IsOptional()
  @IsBoolean()
  supportsLanguage?: boolean;

  /**
   * Optional non-secret source configuration.
   *
   * API secrets must remain in environment variables and must
   * never be stored inside this field.
   */
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}