import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO used to submit a Contact Us message.
 *
 * The endpoint is publicly accessible and may be used by:
 * - Guest visitors.
 * - Authenticated users.
 *
 * User identity must never be accepted directly from the request body.
 * When authenticated-user linking is required, userId should be obtained
 * from the verified JWT request context.
 *
 * @author Malak
 */
export class CreateContactMessageDto {
  /**
   * Sender full name.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  /**
   * Sender email address.
   */
  @IsEmail()
  @MaxLength(150)
  email!: string;

  /**
   * Message subject.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  /**
   * Detailed message body.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(2_000)
  message!: string;
}
