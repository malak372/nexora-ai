import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ComplaintStatus, ComplaintPriority } from '@prisma/client';

/**
 * DTO for updating an existing user complaint.
 *
 * This DTO is used with the PATCH /admin/complaints/:id endpoint.
 * It defines the optional fields that an administrator can modify
 * when reviewing and managing a complaint.
 *
 * All properties are optional, allowing the admin to update
 * one or more fields without affecting the remaining complaint data.
 *
 * Supported updates:
 * - Complaint status.
 * - Complaint priority.
 * - Administrative reply.
 *
 * Example:
 * {
 *   "status": "RESOLVED",
 *   "priority": "HIGH",
 *   "adminReply": "The reported issue has been investigated and resolved."
 * }
 *
 * @author Malak
 */
export class UpdateComplaintDto {
  /**
   * Updated complaint status.
   *
   * Must be one of the values defined in the
   * ComplaintStatus enum.
   *
   * Example:
   * RESOLVED
   */
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  /**
   * Updated complaint priority.
   *
   * Must be one of the values defined in the
   * ComplaintPriority enum.
   *
   * Example:
   * HIGH
   */
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  /**
   * Optional administrative reply.
   *
   * Contains the response written by the administrator
   * regarding the submitted complaint.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  adminReply?: string;
}