import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

/**
 * Data Transfer Object (DTO) used to request
 * a password reset email.
 *
 * The email address is automatically trimmed
 * and converted to lowercase before validation.
 *
 * @author Eman
 */
export class ForgotPasswordDto {
  /**
   * User email address.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;
}
