import { UserType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Data Transfer Object (DTO) used for user registration.
 *
 * This DTO validates the information required to create
 * a new user account, including the full name, email,
 * password, optional user type, and optional guest session token.
 *
 * @author Eman
 */
export class RegisterDto {
  /**
   * User's full name.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  fullName!: string;

  /**
   * User's email address.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  /**
   * User account password.
   */
  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password!: string;

  /**
   * Optional user type.
   *
   * Used to classify registered users for analytics
   * and personalization. This is not used for authorization.
   */
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  /**
   * Optional guest session token.
   *
   * If provided, the system transfers any guest-generated
   * ideas associated with the session to the newly registered user.
   *
   * This field is ignored when no guest session exists.
   */
  @IsOptional()
  @IsString()
  guestSessionToken?: string;
}
