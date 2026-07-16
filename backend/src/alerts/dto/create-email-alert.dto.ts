import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by administrators to send email alerts.
 *
 * If a recipient user ID is provided, the email is sent
 * only to that user. Otherwise, the email is broadcast
 * to all eligible users.
 *
 * Email alerts do not create records in the Alert table.
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
   * Email body.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(3000)
  message!: string;

  /**
   * Optional recipient user identifier.
   *
   * When omitted, the email is broadcast.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}