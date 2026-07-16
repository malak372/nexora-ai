import { LanguageCode } from '@prisma/client';

import { Type } from 'class-transformer';

import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO used to manually start the Data Collection
 * pipeline stage.
 *
 * A registered user or administrator may select DataSource.key
 * values directly.
 *
 * @author Malak
 */
export class RunCollectionDto {
  /**
   * Selected software-domain identifier.
   */
  @IsUUID('4')
  domainId!: string;

  /**
   * Optional country context.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  /**
   * Optional city context.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  /**
   * Optional region context.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  /**
   * Requested collection and analysis language.
   */
  @IsEnum(LanguageCode)
  language!: LanguageCode;

  /**
   * Optional geographical radius.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  radiusKm?: number;

  /**
   * Stable DataSource.key values.
   *
   * Examples:
   * - youtube
   * - github
   * - app-store
   * - google-play
   * - dev-to
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Matches(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    {
      each: true,
    },
  )
  dataSourceKeys?: string[];

  /**
   * Optional custom collection keywords.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];
}