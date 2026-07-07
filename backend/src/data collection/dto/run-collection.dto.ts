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
 * DTO used by admins to manually start a data collection job.
 *
 * Notes:
 * - Admin must explicitly choose platforms.
 * - User idea generation can use optional platforms in GenerateIdeaDto later.
 *
 * @author Malak
 */
export class RunCollectionDto {
  @IsUUID()
  domainId!: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsEnum(LanguageCode)
  language!: LanguageCode;

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