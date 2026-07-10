import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ComplaintPriority, ComplaintStatus } from '@prisma/client';

/**
 * DTO for updating an existing user complaint.
 *
 * Used with:
 * PATCH /admin/complaints/:id
 *
 * Allows the administrator to update:
 * - Complaint status.
 * - Complaint priority.
 * - Administrative reply.
 *
 * All properties are optional to support partial updates.
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
