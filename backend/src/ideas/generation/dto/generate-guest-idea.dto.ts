import { LanguageCode } from '@prisma/client';

import { GuestDescriptionOrDomainConstraint } from '../validators/guest-description-or-domain.validator';

import { Transform, type TransformFnParams, Type } from 'class-transformer';

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';

/**
 * Request body used by guest users to start their single
 * guest idea-generation run.
 *
 * The guest-session token is not accepted in the request body.
 * It should be resolved from the secure guest-session cookie.
 *
 * Guest generation always resolves to GUEST_FREE.
 *
 * @author Malak
 * @author Eman
 */
export class GenerateGuestIdeaDto {
  /**
   * Internal validation marker used to enforce that the guest either selects
   * a domain or provides a sufficiently detailed description.
   */
  @Validate(GuestDescriptionOrDomainConstraint)
  readonly guestDescriptionOrDomainIsValid = true;

  /**
   * Software domain selected by the guest.
   */
  @IsOptional()
  @IsUUID('4')
  domainId?: string;

  /**
   * Optional free-text description used to resolve one concrete domain when
   * domainId is omitted or points to the General domain.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  description?: string;

  /**
   * Country associated with the collection request.
   */
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  country!: string;

  /**
   * Optional city used as collection metadata.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  city?: string;

  /**
   * Optional region used as collection metadata.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  region?: string;

  /**
   * Optional search radius in kilometres.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  radiusKm?: number;

  /**
   * Preferred language metadata.
   */
  @IsEnum(LanguageCode)
  language!: LanguageCode;

  /**
   * Language of the generated idea content.
   *
   * This is intentionally separate from `language`, which controls collection
   * and community-evidence language metadata. The frontend should send its
   * active interface language here so evidence may be collected in one
   * language while the generated idea is written in another.
   */
  @IsOptional()
  @IsEnum(LanguageCode)
  outputLanguage?: LanguageCode;

  /**
   * Forces the pipeline to ignore compatible historical collection jobs
   * and collect fresh community data for this request.
   *
   * When omitted or false, a recent compatible collection job may be reused.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams): unknown => {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return value;
  })
  forceRefresh?: boolean;

  /**
   * Optional guest-provided keywords.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(({ value }: TransformFnParams): unknown => {
    if (!Array.isArray(value)) {
      return value;
    }

    return [
      ...new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  })
  keywords?: string[];
}