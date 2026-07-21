import { ComplaintPriority, ComplaintStatus } from '@prisma/client';

import { Transform, type TransformFnParams } from 'class-transformer';

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
 * - Complaint status.
 * - Complaint priority.
 * - Administrator reply.
 *
 * The administrator reply is trimmed before validation.
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
   *
   * Leading and trailing whitespace is removed before validation.
   */
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(1_000)
  adminReply?: string;
}
