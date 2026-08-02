import { Transform } from 'class-transformer';

import { IsEmail, IsString, Matches } from 'class-validator';

/**
 * DTO used to validate an email-verification-code request.
 *
 * The email is normalized before validation. The verification code must
 * contain exactly six decimal digits.
 *
 * @author Eman
 */
export class VerifyEmailDto {
  /** User email address. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  email!: string;

  /** Six-digit email-verification code received by email. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Verification code must contain exactly 6 digits',
  })
  code!: string;
}