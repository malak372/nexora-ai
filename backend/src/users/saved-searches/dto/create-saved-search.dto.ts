import { LanguageCode } from '@prisma/client';

import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * DTO used to create a reusable saved generation search.
 *
 * Stores generation criteria that an authenticated user may reuse
 * when generating another software project idea.
 *
 * @author Eman
 */
export class CreateSavedSearchDto {
  /**
   * Optional user-defined name for the saved search.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  /**
   * Optional active software-domain identifier.
   */
  @IsOptional()
  @IsUUID()
  domainId?: string;

  /**
   * Optional country filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  /**
   * Optional city filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  /**
   * Optional region filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  /**
   * Optional language used by the generation request.
   */
  @IsOptional()
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  /**
   * Optional backend data-source registry keys.
   *
   * Examples:
   * - youtube
   * - github
   * - stack-overflow
   * - dev-to
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    each: true,
    message:
      'Each data source key must use lowercase kebab-case characters only.',
  })
  dataSourceKeys?: string[];

  /**
   * Optional custom keywords reused during data collection
   * and idea generation.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];
}
