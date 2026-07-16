import { Transform } from 'class-transformer';

import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/**
 * Minimum allowed password length.
 */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Password must contain at least one letter
 * and one number.
 */
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * DTO used to reset a user's password
 * using a valid password-reset token.
 *
 * @author Eman
 */
export class ResetPasswordDto {
  /**
   * Password-reset token received by email.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  token!: string;

  /**
   * New account password.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: 'Password must contain at least one letter and one number.',
  })
  newPassword!: string;
}
