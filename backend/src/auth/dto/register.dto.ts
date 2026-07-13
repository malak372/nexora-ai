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
 * Data Transfer Object used for user registration.
 *
 * Guest-session identification is read from the secure
 * HTTP-only cookie and is not accepted from the request body.
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
   * Optional user classification.
   *
   * Used for analytics and personalization,
   * not for authorization.
   */
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;
}
