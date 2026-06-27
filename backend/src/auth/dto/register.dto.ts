import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

/**
 * Data Transfer Object (DTO) used for user registration.
 *
 * This DTO validates the information required to create
 * a new user account, including the full name, email,
 * and a password that meets the minimum security requirements.
 *
 * @author Eman
 */
export class RegisterDto {
  @IsString()
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password!: string;
}