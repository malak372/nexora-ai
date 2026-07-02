import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Data Transfer Object (DTO) used to reset
 * the user's password using a valid reset token.
 *
 * Validates the reset token and the new password,
 * ensuring the new password satisfies the application's
 * minimum security requirements.
 *
 * @author Eman
 */
export class ResetPasswordDto {
  /**
   * Password reset token sent to the user's email.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  token!: string;

  /**
   * New account password.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  newPassword!: string;
}