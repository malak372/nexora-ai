import { AlertType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a new alert.
 *
 * This DTO is used with the POST /admin/alerts endpoint.
 * It defines the required and optional data needed to send
 * a notification to a specific user or to all active users.
 *
 * Validation Rules:
 * - Alert title must be a string with a minimum length of 3 characters.
 * - Alert message must be a string with a minimum length of 5 characters.
 * - Alert type is optional and must be a valid AlertType value if provided.
 * - User ID is optional and must be a string if provided.
 *
 * If no userId is supplied, the alert will be broadcast
 * to all active users.
 *
 * Example:
 * {
 *   "title": "System Maintenance",
 *   "message": "The platform will be unavailable tonight from 10 PM to 12 AM.",
 *   "type": "SYSTEM",
 *   "userId": "f6d5c8d1-2c6f-4d54-9d9e-123456789abc"
 * }
 *
 * @author Malak
 */
export class CreateAlertDto {
  /**
   * Alert title.
   *
   * Must be a string containing at least
   * 3 characters.
   *
   * Example:
   * System Maintenance
   */
  @IsString()
  @MinLength(3)
  title!: string;

  /**
   * Alert message.
   *
   * Must be a string containing at least
   * 5 characters.
   *
   * Example:
   * The platform will be unavailable tonight from 10 PM to 12 AM.
   */
  @IsString()
  @MinLength(5)
  message!: string;

  /**
   * Optional alert type.
   *
   * Must be one of the values defined in
   * the AlertType enum.
   *
   * If omitted, the service assigns the
   * SYSTEM type by default.
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
   * If provided, the alert is sent only
   * to the specified user.
   *
   * If omitted, the alert is broadcast
   * to all active users.
   */
  @IsOptional()
  @IsString()
  userId?: string;
}