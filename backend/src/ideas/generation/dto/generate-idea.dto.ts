import {
  IdeaGenerationType,
  LanguageCode,
} from '@prisma/client';

import { Transform, Type } from 'class-transformer';

import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Generation types accepted from authenticated users.
 *
 * GUEST_FREE is intentionally excluded because guest generation
 * uses GenerateGuestIdeaDto and the guest-generation controller.
 *
 * @author Malak
 */
const REGISTERED_IDEA_GENERATION_TYPES = [
  IdeaGenerationType.NORMAL_FREE,
  IdeaGenerationType.PREMIUM_CREDIT,
] as const;

/**
 * Generation type accepted by GenerateIdeaDto.
 *
 * @author Malak
 */
export type RegisteredIdeaGenerationType =
  (typeof REGISTERED_IDEA_GENERATION_TYPES)[number];

/**
 * Request body used by authenticated users to start a new
 * idea-generation run.
 *
 * Registered users may request:
 * - NORMAL_FREE
 * - PREMIUM_CREDIT
 *
 * Guest generation uses GenerateGuestIdeaDto instead.
 *
 * Data sources are identified using stable string keys rather
 * than Prisma enums.
 *
 * @author Malak
 */
export class GenerateIdeaDto {
  /**
   * Software domain used for data collection, NLP analysis and
   * idea generation.
   */
  @IsUUID('4')
  domainId!: string;

  /**
   * Requested generation entitlement.
   *
   * Only registered-user generation types are accepted here.
   * The generation-policy service later verifies whether the
   * authenticated user has the required entitlement.
   */
  @IsIn(REGISTERED_IDEA_GENERATION_TYPES)
  generationType!: RegisteredIdeaGenerationType;

  /**
   * Country associated with the collection request.
   */
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim()
      : value,
  )
  country!: string;

  /**
   * Optional city used as collection metadata.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim()
      : value,
  )
  city?: string;

  /**
   * Optional region used as collection metadata.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim()
      : value,
  )
  region?: string;

  /**
   * Optional search radius in kilometres.
   *
   * Collectors that do not support radius-based collection may
   * ignore this value.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  radiusKm?: number;

  /**
   * Preferred language metadata for generation.
   *
   * Language must not automatically exclude collected community
   * content unless a collector explicitly supports and applies
   * language filtering.
   */
  @IsEnum(LanguageCode)
  language!: LanguageCode;

  /**
   * Optional data-source keys selected by the user.
   *
   * When omitted, the generation-selection service resolves all
   * active and implemented data sources allowed by the current
   * configuration.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    each: true,
    message:
      'Each data source key must use lowercase kebab-case characters.',
  })
  @Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return [
      ...new Set(
        value
          .filter(
            (item): item is string =>
              typeof item === 'string',
          )
          .map((item) =>
            item.trim().toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];
  })
  dataSourceKeys?: string[];

  /**
   * Optional user-provided keywords that supplement domain
   * keywords during data collection.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return [
      ...new Set(
        value
          .filter(
            (item): item is string =>
              typeof item === 'string',
          )
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  })
  keywords?: string[];
}