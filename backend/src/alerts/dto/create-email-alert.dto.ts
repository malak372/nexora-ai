import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by an administrator to send an email alert.
 *
 * If userId is provided, the email is sent to one user.
 * If userId is omitted, the email is sent to all active users.
 *
 * Email alerts do not create Alert database records.
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
  @MaxLength(3_000)
  message!: string;

  /**
   * Optional recipient user ID.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
