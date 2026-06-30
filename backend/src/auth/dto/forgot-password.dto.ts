import { IsEmail } from 'class-validator';

/**
 * DTO used to request a password reset email.
 *
 * @author Eman
 */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}