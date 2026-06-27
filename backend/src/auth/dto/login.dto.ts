import { IsEmail, IsString } from 'class-validator';

/**
 * Data Transfer Object (DTO) used for user authentication.
 *
 * This DTO validates the credentials required for user login,
 * including a valid email address and a password.
 *
 * @author Eman
 */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}