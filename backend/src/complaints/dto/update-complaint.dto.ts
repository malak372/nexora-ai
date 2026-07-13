import { ComplaintPriority, ComplaintStatus } from '@prisma/client';

import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by an administrator to update a complaint.
 *
 * Supports partial updates for:
 * - Status.
 * - Priority.
 * - Administrator reply.
 *
 * @author Malak
 */
export class UpdateComplaintDto {
  /**
   * Updated complaint status.
   */
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  /**
   * Updated complaint priority.
   */
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  /**
   * Optional administrator reply.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1_000)
  adminReply?: string;
}
