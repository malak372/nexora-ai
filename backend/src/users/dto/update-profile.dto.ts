import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Data Transfer Object (DTO) used for updating
 * the authenticated user's profile.
 *
 * This DTO allows users to update their profile
 * information. Currently, only the user's full
 * name can be updated.
 *
 * @author Eman
 */
export class UpdateProfileDto {
  /**
   * User's full name.
   *
   * This field is optional and must contain
   * at least two characters if provided.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;
}