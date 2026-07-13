import { CollectionSourceType, LanguageCode } from '@prisma/client';

import { Type } from 'class-transformer';

import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Input used to generate one software project idea.
 *
 * @author Malak
 */
export class GenerateIdeaDto {
  /**
   * Active domain selected by the requester.
   */
  @IsUUID()
  domainId!: string;

  /**
   * Country used for collection and generation context.
   */
  @IsString()
  @MaxLength(100)
  country!: string;

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
   * ANY permits all supported content languages.
   */
  @IsOptional()
  @IsEnum(LanguageCode)
  language: LanguageCode = LanguageCode.ANY;

  /**
   * Optional geographical radius.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  radiusKm?: number;

  /**
   * Optional advanced platform selection.
   *
   * Only active platforms may be used.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEnum(CollectionSourceType, {
    each: true,
  })
  platforms?: CollectionSourceType[];

  /**
   * Optional custom collection keywords.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({
    each: true,
  })
  @MaxLength(100, {
    each: true,
  })
  keywords?: string[];
}
