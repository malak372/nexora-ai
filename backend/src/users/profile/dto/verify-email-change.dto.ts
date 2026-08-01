import { IsString, Matches } from 'class-validator';

/** Verifies one six-digit email-change confirmation code. */
export class VerifyEmailChangeDto {
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Verification code must contain exactly 6 digits.',
  })
  code!: string;
}