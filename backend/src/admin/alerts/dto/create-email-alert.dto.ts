import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for sending an email alert.
 *
 * Used with:
 * POST /admin/alerts/email
 *
 * If userId is provided, the email is sent to one user.
 * If userId is omitted, the email is sent to all active users.
 *
 * @author Malak
 */
export class CreateEmailAlertDto {
  /**
   * Email subject.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  /**
   * Email message body.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(3000)
  message!: string;

  /**
   * Optional recipient user ID.
   *
   * If omitted, the email will be sent
   * to all active users.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
