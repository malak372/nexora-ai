import { AlertType } from '@prisma/client';

import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by an administrator to create an in-app alert.
 *
 * If userId is provided, the alert is sent to one user.
 * If userId is omitted, the alert is broadcast to all active users.
 *
 * @author Malak
 */
export class CreateAlertDto {
  /**
   * Alert title.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  title!: string;

  /**
   * Alert message.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(1_000)
  message!: string;

  /**
   * Optional alert type.
   *
   * Defaults to SYSTEM inside the service to preserve
   * the existing application behavior.
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  /**
   * Optional recipient user ID.
   *
   * When omitted, the alert is broadcast.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
