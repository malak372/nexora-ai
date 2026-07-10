import { UserType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Data Transfer Object (DTO) used to update
 * the authenticated user's profile.
 *
 * This DTO allows authenticated users to update
 * editable profile information only.
 *
 * Supported updates:
 * - Full name.
 * - User type.
 *
 * The following fields cannot be modified through
 * this DTO:
 * - Role.
 * - Account status.
 * - Credit balance.
 * - Free generation usage.
 *
 * Premium access is managed automatically by the
 * system according to the user's available credits.
 *
 * @author Eman
 */
export class UpdateProfileDto {
  /**
   * User's full name.
   *
   * Optional field.
   *
   * When provided, the value must contain
   * at least two characters.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  /**
   * Category of the authenticated user.
   *
   * Optional field.
   *
   * This field identifies the user's category
   * to support analytics, personalization,
   * and future project recommendation features.
   *
   * Updating this field does not affect:
   * - User permissions.
   * - Premium status.
   * - Credit balance.
   */
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;
}
