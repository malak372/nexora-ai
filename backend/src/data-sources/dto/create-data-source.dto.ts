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
 * isImplemented is an administrative implementation switch. It can only be
 * enabled when a collector with the same key exists in the deployed runtime.
 *
 * @author Malak
 */
export class CreateDataSourceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'key must contain lowercase letters, numbers, and single hyphens only.',
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName!: string;

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