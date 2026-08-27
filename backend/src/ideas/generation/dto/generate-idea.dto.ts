import { IdeaGenerationType, LanguageCode } from '@prisma/client';

import { Transform, type TransformFnParams, Type } from 'class-transformer';

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
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
  @IsOptional()
  @IsUUID('4')
  domainId?: string;

  /**
   * Optional ordered list of concrete domains used for cross-domain generation.
   *
   * The first domain remains the primary persistence domain. Every selected
   * domain contributes its name and keywords to evidence collection, AI
   * opportunity extraction, and the final problem-to-solution portfolio.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  @Transform(({ value }: TransformFnParams): unknown => {
    if (!Array.isArray(value)) {
      return value;
    }

    return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  })
  domainIds?: string[];

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
   * Forces the generation pipeline to ignore compatible historical
   * collection jobs and collect fresh community data.
   *
   * When omitted or false, the resolver may reuse a recent compatible
   * collection job that satisfies the configured freshness and quality
   * requirements.
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
   * Optional user-provided keywords that supplement domain
   * keywords during data collection.
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