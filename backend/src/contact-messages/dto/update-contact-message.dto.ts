import { ContactMessageStatus } from '@prisma/client';
import { Transform } from 'class-transformer';

import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by an administrator to update a Contact Us message.
 *
 * Supports partial updates for:
 * - Message status.
 * - Administrator reply.
 *
 * When an administrator reply is supplied without an explicit
 * status, the service automatically changes the status to REPLIED.
 *
 * @author Malak
 */
export class UpdateContactMessageDto {
  /**
   * Optional updated message status.
   */
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;

  /**
   * Optional administrator reply.
   *
   * Leading and trailing whitespace is removed before validation.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(1_000)
  adminReply?: string;
}
