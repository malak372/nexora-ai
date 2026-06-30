import { IsString, Matches, MinLength } from 'class-validator';

/**
 * DTO used to reset the user's password using a valid reset token.
 *
 * @author Eman
 */
export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  newPassword!: string;
}