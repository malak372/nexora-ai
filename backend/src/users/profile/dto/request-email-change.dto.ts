import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Starts a two-step email change for the authenticated user. */
export class RequestEmailChangeDto {
  @IsEmail()
  @MaxLength(255)
  newEmail!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  currentPassword!: string;
}