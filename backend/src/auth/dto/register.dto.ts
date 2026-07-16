import { UserType } from '@prisma/client';

import { Transform } from 'class-transformer';

import { IsEmail, IsEnum, IsString, Matches, MinLength } from 'class-validator';

/**
 * Minimum allowed password length.
 */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Password must contain at least one letter
 * and one number.
 */
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * DTO used for user registration.
 *
 * Guest-session identification is obtained
 * from the secure HTTP-only cookie and is
 * never accepted from the request body.
 *
 * @author Eman
 */
export class RegisterDto {
  /**
   * User's full name.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  fullName!: string;

  /**
   * User's email address.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  email!: string;

  /**
   * User account password.
   */
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: 'Password must contain at least one letter and one number.',
  })
  password!: string;

  /**
   * Required user classification.
   *
   * Used for personalization, analytics,
   * and audience-based idea publication.
   *
   * This value is not used for authorization.
   */
  @IsEnum(UserType)
  userType!: UserType;
}
