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
 * DTO for creating a new alert.
 *
 * Used with:
 * POST /admin/alerts
 *
 * This DTO defines the data required to send:
 * - An alert to a specific user.
 * - Or a broadcast alert to all active users.
 *
 * Validation Rules:
 * - title must be a string between 3 and 100 characters.
 * - message must be a string between 5 and 1000 characters.
 * - type is optional and must be a valid AlertType value.
 * - userId is optional and must be a valid UUID if provided.
 *
 * If no userId is provided, the alert will be broadcast
 * to all active users.
 *
 * @author Malak
 */
export class CreateAlertDto {
  /**
   * Alert title.
   *
   * Must contain between 3 and 100 characters.
   *
   * Example:
   * System Maintenance
   */
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  title!: string;

  /**
   * Alert message.
   *
   * Must contain between 5 and 1000 characters.
   *
   * Example:
   * The platform will be unavailable tonight from 10 PM to 12 AM.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  message!: string;

  /**
   * Optional alert type.
   *
   * Must be one of the values defined in AlertType enum.
   *
   * If omitted, the service assigns SYSTEM by default.
   *
   * Example:
   * SYSTEM
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  /**
   * Optional recipient user ID.
   *
   * If provided, the alert is sent only to this user.
   * If omitted, the alert is broadcast to all active users.
   *
   * Must be a valid UUID.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
