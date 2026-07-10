import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a Contact Us message.
 *
 * Used with:
 * POST /contact
 *
 * Can be used by:
 * - Guest users.
 * - Authenticated users.
 *
 * @author Malak
 */
export class CreateContactMessageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;

  /**
   * Optional user ID.
   *
   * Usually should not be sent from frontend.
   * Prefer taking userId from JWT when available.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
