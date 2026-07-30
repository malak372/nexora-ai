import { LanguageCode } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Updates the authenticated user's personalization preferences.
 *
 * The selected option identifiers must belong to active options
 * from the server-managed preference catalog.
 *
 * @author Malak
 */
export class UpdateUserPreferencesDto {
  /** Selected catalog option identifiers. */
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  preferenceOptionIds!: string[];

  /** Preferred language for discovery and generated results. */
  @IsOptional()
  @IsEnum(LanguageCode)
  preferredLanguage?: LanguageCode;

  /** Preferred country used for localized discovery. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  preferredCountry?: string;

  /** Preferred city used for localized discovery. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  preferredCity?: string;

  /** Preferred region used for localized discovery. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  preferredRegion?: string;
}
