import { Transform } from 'class-transformer';

import {
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Minimum allowed password length.
 */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Password must contain at least one letter
 * and one number.
 */
const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * DTO used to change the authenticated
 * user's password.
 *
 * Validates the current password and
 * ensures the new password satisfies
 * the application's password policy.
 *
 * @author Eman
 */
export class ChangePasswordDto {
  /**
   * User's current password.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim()
      : value,
  )
  @IsString()
  currentPassword!: string;

  /**
   * New account password.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim()
      : value,
  )
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message:
      'New password must contain at least one letter and one number.',
  })
  newPassword!: string;
}