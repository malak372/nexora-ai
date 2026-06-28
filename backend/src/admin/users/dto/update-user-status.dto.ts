import { IsBoolean } from 'class-validator';

/**
 * DTO for updating a user's account status.
 *
 * This DTO is used by administrators to activate or deactivate
 * a user account. The request body must contain a boolean value
 * indicating whether the account should remain active.
 *
 * Validation Rules:
 * - isActive must be a boolean value.
 *
 * Example:
 * {
 *   "isActive": false
 * }
 *
 * Result:
 * - true  -> User account is activated.
 * - false -> User account is deactivated.
 * @author Malak
 */
export class UpdateUserStatusDto {
  /**
   * Indicates whether the user account is active.
   * - true: Active account.
   * - false: Deactivated account.
   */
  @IsBoolean()
  isActive!: boolean;
}