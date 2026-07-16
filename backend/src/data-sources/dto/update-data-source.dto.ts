import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used to update editable data-source metadata.
 *
 * The following fields cannot be updated here:
 * - key: stable backend registry identifier.
 * - isImplemented: derived from CollectorsFactory.
 * - isActive: updated through the dedicated status endpoint.
 *
 * @author Malak
 */
export class UpdateDataSourceDto {
  /**
   * Human-readable source name.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName?: string;

  /**
   * Optional source description.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /**
   * Indicates support for post-like records.
   */
  @IsOptional()
  @IsBoolean()
  supportsPosts?: boolean;

  /**
   * Indicates support for comments or reviews.
   */
  @IsOptional()
  @IsBoolean()
  supportsComments?: boolean;

  /**
   * Indicates support for geographical filtering.
   */
  @IsOptional()
  @IsBoolean()
  supportsRegion?: boolean;

  /**
   * Indicates support for language filtering.
   */
  @IsOptional()
  @IsBoolean()
  supportsLanguage?: boolean;

  /**
   * Optional non-secret source configuration.
   */
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}
