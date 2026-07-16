import { Transform } from 'class-transformer';

import { IsEmail, IsString } from 'class-validator';

/**
 * DTO used to request a password-reset email.
 *
 * The email address is normalized before validation
 * by trimming whitespace and converting it to lowercase.
 *
 * @author Eman
 */
export class ForgotPasswordDto {
  /**
   * User email address.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  email!: string;
}
