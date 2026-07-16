import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used to submit a Contact Us message.
 *
 * The DTO may be used by:
 * - Guest visitors through the public endpoint.
 * - Authenticated users through the protected endpoint.
 *
 * For authenticated submissions, the service ignores fullName
 * and email from the request body and uses the verified user's
 * persisted account information instead.
 *
 * All string inputs are normalized before validation.
 *
 * @author Malak
 */
export class CreateContactMessageDto {
  /**
   * Sender full name.
   *
   * Used directly only for guest submissions.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  /**
   * Sender email address.
   *
   * Used directly only for guest submissions.
   * The value is trimmed and converted to lowercase.
   */
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : value,
  )
  @IsEmail()
  @MaxLength(150)
  email!: string;

  /**
   * Contact-message subject.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  /**
   * Detailed contact-message body.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2_000)
  message!: string;
}
