import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const ADMIN_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * Accepts one administrator invitation.
 *
 * Possession of the one-time code proves control of the invited mailbox.
 */
export class AcceptAdminInvitationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^\d{8}$/, {
    message: 'Invitation code must contain exactly 8 digits.',
  })
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(ADMIN_PASSWORD_REGEX, {
    message: 'Password must contain at least one letter and one number.',
  })
  password!: string;
}