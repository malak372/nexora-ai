import {
  IdeaPublicationStatus,
  IdeaPublicationVisibility,
} from '@prisma/client';

import { Transform, type TransformFnParams } from 'class-transformer';

import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query options used to retrieve publications accepted by
 * the authenticated user.
 *
 * Date filters inherited from ListQueryDto are applied to the
 * acceptance date rather than the publication creation date.
 *
 * Supported sorting fields:
 * - acceptedAt
 * - createdAt
 * - updatedAt
 *
 * @author Malak
 */
export class GetAcceptedPublicationsQueryDto extends ListQueryDto {
  /**
   * Optionally filters accepted publications by their
   * current publication status.
   */
  @IsOptional()
  @IsEnum(IdeaPublicationStatus)
  status?: IdeaPublicationStatus;

  /**
   * Optionally filters accepted publications by their
   * current visibility configuration.
   */
  @IsOptional()
  @IsEnum(IdeaPublicationVisibility)
  visibility?: IdeaPublicationVisibility;

  /**
   * Optionally filters acceptance records according to whether
   * advanced publication details have been unlocked.
   *
   * Supported query values:
   * - true
   * - false
   */
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown => {
    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  advancedUnlocked?: boolean;
}
