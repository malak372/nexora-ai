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
 * DTO used by administrators to create an in-app alert.
 *
 * If a recipient user ID is provided, the alert is sent to
 * that user only. Otherwise, the alert is broadcast to all
 * eligible users.
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
  @MaxLength(1000)
  message!: string;

  /**
   * Alert category.
   */
  @IsOptional()
  @IsEnum(AlertType)
  type: AlertType = AlertType.SYSTEM;

  /**
   * Optional recipient user identifier.
   *
   * When omitted, the alert is broadcast.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}