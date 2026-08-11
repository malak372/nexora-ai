import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used to update editable data-source metadata and administrative state.
 *
 * The source key stays immutable because it is the stable collector registry
 * identifier. Runtime implementation is still verified by CollectorsFactory.
 *
 * @author Malak
 */
export class UpdateDataSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isImplemented?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsPosts?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsComments?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsRegion?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsLanguage?: boolean;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}