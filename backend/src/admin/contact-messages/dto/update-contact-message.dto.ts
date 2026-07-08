import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ContactMessageStatus } from '@prisma/client';

/**
 * DTO for updating an existing contact message.
 *
 * Used with:
 * PATCH /admin/contact-messages/:id
 *
 * Allows the administrator to update:
 * - Contact message status.
 * - Administrative reply.
 *
 * All properties are optional to support partial updates.
 *
 * @author Malak
 */
export class UpdateContactMessageDto {
  /**
   * Updated contact message status.
   */
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;

  /**
   * Optional administrative reply.
   *
   * Must contain between 5 and 1000 characters.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  adminReply?: string;
}