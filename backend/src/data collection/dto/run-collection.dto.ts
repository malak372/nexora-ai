import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CollectionSourceType, LanguageCode } from '@prisma/client';

/**
 * DTO used by admins to start a new data collection job.
 *
 * @author Malak
 */
export class RunCollectionDto {
  @IsUUID()
  domainId!: string;

  @IsOptional()
  @IsString()
  domainName?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  radiusKm?: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(CollectionSourceType, { each: true })
  platforms!: CollectionSourceType[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}