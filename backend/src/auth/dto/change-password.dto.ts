import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Data Transfer Object (DTO) used to change
 * the authenticated user's password.
 *
 * Validates the current password and the new password,
 * ensuring the new password satisfies the application's
 * minimum security requirements.
 *
 * @author Eman
 */
export class ChangePasswordDto {
  /**
   * User's current password.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  currentPassword!: string;

  /**
   * New account password.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'New password must contain at least one letter and one number',
  })
  newPassword!: string;
}
