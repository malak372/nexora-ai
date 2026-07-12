import { ContactMessageStatus } from '@prisma/client';

import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by an administrator to update one contact message.
 *
 * Supports partial updates for:
 * - Message status.
 * - Administrator reply.
 *
 * @author Malak
 */
export class UpdateContactMessageDto {
  /**
   * Updated message status.
   */
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;

  /**
   * Optional administrator reply.
   *
   * When supplied without an explicit status, the service
   * automatically changes the status to REPLIED.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1_000)
  adminReply?: string;
}