import { LanguageCode } from '@prisma/client';

import { Transform, type TransformFnParams } from 'class-transformer';

import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Request used to preview whether previously collected data
 * can be reused before starting a new idea-generation run.
 *
 * The request contains the domain-resolution context, location,
 * language, keywords, and preferred collection sources.
 *
 * @author Eman
 */
export class CollectionPreviewDto {
  /**
   * Optional explicitly selected domain identifier.
   *
   * When omitted, the backend may resolve the domain using
   * the description, keywords, or user preferences.
   */
  @IsOptional()
  @IsUUID('4')
  domainId?: string;

  /**
   * Optional natural-language description of the requested idea.
   *
   * This value may be used during automatic domain resolution.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  description?: string;

  /**
   * Required country used to match reusable collection jobs.
   */
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  country!: string;

  /**
   * Optional city used to narrow reusable collection-job matching.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  city?: string;

  /**
   * Optional region used to narrow reusable collection-job matching.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  region?: string;

  /**
   * Language used for collection matching and domain resolution.
   */
  @IsEnum(LanguageCode)
  language!: LanguageCode;

  /**
   * Optional keywords used during automatic domain resolution.
   *
   * A maximum of 20 keywords may be supplied.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({
    each: true,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : value,
  )
  keywords?: string[];

  /**
   * Optional collection-source keys used to compare the request
   * with previously completed collection jobs.
   *
   * A maximum of 20 source keys may be supplied.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({
    each: true,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      : value,
  )
  dataSourceKeys?: string[];
}
