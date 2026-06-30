import { IsBoolean } from 'class-validator';

/**
 * DTO for updating a user's active status.
 *
 * This DTO is used by administrators to enable
 * or disable a user account.
 *
 * Used with:
 * PATCH /admin/users/:id/status
 *
 * Validation Rules:
 * - isActive must be a boolean value.
 *
 * Example:
 * {
 *   "isActive": false
 * }
 *
 * @author Malak
 */
export class UpdateUserStatusDto {
  /**
   * Indicates whether the user account should be active.
   *
   * Accepted values:
   * - true: Activate the user account.
   * - false: Deactivate the user account.
   */
  @IsBoolean()
  isActive!: boolean;
}