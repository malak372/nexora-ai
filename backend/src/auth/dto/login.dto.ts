import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';

/**
 * Data Transfer Object (DTO) used for user authentication.
 *
 * This DTO validates the credentials required for user login,
 * including a valid email address and password.
 *
 * The email address is automatically trimmed and converted
 * to lowercase before validation.
 *
 * @author Eman
 */
export class LoginDto {
  /**
   * User email address.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  /**
   * User password.
   */
  @IsString()
  password!: string;
}