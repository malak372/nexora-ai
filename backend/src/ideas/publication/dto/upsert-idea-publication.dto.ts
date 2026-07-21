import { IdeaPublicationVisibility } from '@prisma/client';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  IDEA_PUBLICATION_AUDIENCE_TYPES,
  MAX_PUBLICATION_AUDIENCES,
} from '../constants/idea-publication.constants';
import type { IdeaPublicationAudienceType } from '../types/idea-publication.type';

/**
 * Represents a single audience rule for a publication
 * with restricted visibility.
 *
 * Each entry defines:
 * - The audience type.
 * - The audience identifier or value.
 *
 * @author Malak
 */
export class IdeaPublicationAudienceDto {
  /**
   * Audience category.
   *
   * Examples:
   * - user-type
   * - specific-user
   * - organization
   */
  @IsIn(IDEA_PUBLICATION_AUDIENCE_TYPES)
  audienceType!: IdeaPublicationAudienceType;

  /**
   * Audience identifier associated with the selected type.
   */
  @IsString()
  @MaxLength(150)
  audienceValue!: string;
}

/**
 * DTO used to create or update the public publication
 * snapshot of an idea.
 *
 * This DTO intentionally accepts only information that can
 * be safely exposed to other users.
 *
 * Premium outputs, internal AI results, implementation details,
 * and other protected content are never accepted through this DTO.
 *
 * @author Malak
 */
export class UpsertIdeaPublicationDto {
  /**
   * Publication visibility level.
   */
  @IsEnum(IdeaPublicationVisibility)
  visibility!: IdeaPublicationVisibility;

  /**
   * Optional public title displayed to users.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  publicTitle?: string;

  /**
   * Optional public abstract describing the idea.
   */
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  publicAbstract?: string;

  /**
   * Optional public problem statement.
   */
  @IsOptional()
  @IsString()
  @MaxLength(3_000)
  publicProblem?: string;

  /**
   * Optional public objectives.
   */
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  publicObjectives?: string;

  /**
   * Optional target users description.
   */
  @IsOptional()
  @IsString()
  @MaxLength(3_000)
  publicTargetUsers?: string;

  /**
   * Enables or disables community ratings.
   */
  @IsOptional()
  @IsBoolean()
  allowRatings?: boolean;

  /**
   * Enables or disables community feedback.
   */
  @IsOptional()
  @IsBoolean()
  allowFeedback?: boolean;

  /**
   * Enables or disables community voting.
   */
  @IsOptional()
  @IsBoolean()
  allowVoting?: boolean;

  /**
   * Optional audience definitions used when the publication
   * visibility is restricted.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PUBLICATION_AUDIENCES)
  @ValidateNested({ each: true })
  @Type(() => IdeaPublicationAudienceDto)
  audiences?: IdeaPublicationAudienceDto[];
}
