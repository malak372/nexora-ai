import { CollectionSourceType, LanguageCode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

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
  /**
   * Domain identifier used for the collection job.
   */
  @IsUUID()
  domainId!: string;

  /**
   * Country associated with the collection job.
   */
  @IsString()
  country!: string;

  /**
   * Optional city filter.
   */
  @IsOptional()
  @IsString()
  city?: string;

  /**
   * Optional region filter.
   */
  @IsOptional()
  @IsString()
  region?: string;

  /**
   * Language used for data collection and analysis.
   */
  @IsEnum(LanguageCode)
  language!: LanguageCode;

  /**
   * Optional search radius in kilometers.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  radiusKm?: number;

  /**
   * Optional collection platforms selected by the admin.
   */
  @IsOptional()
  @IsArray()
  @IsEnum(CollectionSourceType, { each: true })
  platforms?: CollectionSourceType[];

  /**
   * Optional custom keywords used during collection.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
