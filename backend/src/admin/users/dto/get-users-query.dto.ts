import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';
import { AccountStatus, UserRole, UserType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating users.
 *
 * Used by:
 * - GET /admin/users
 * - GET /admin/users/summary
 * - GET /admin/users/charts
 * - GET /admin/users/export/csv
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date range filtering.
 * - Sorting.
 * - Filtering by role.
 * - Filtering by account status.
 * - Filtering by user type.
 * - Filtering by active status.
 *
 * @author Malak
 */
export class GetUsersQueryDto extends ListQueryDto {
  /**
   * Optional user role filter.
   *
   * Accepted values:
   * - USER
   * - ADMIN
   */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /**
   * Optional account status filter.
   *
   * Accepted values depend on AccountStatus enum.
   *
   * Examples:
   * - NORMAL
   * - PREMIUM
   */
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  /**
   * Optional user type filter.
   *
   * This helps the admin analyze users based on
   * their profile type.
   *
   * Examples:
   * - STUDENT
   * - DEVELOPER
   * - COMPANY
   * - RESEARCHER
   * - OTHER
   */
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  /**
   * Optional active status filter.
   *
   * Accepted values:
   * - "true"
   * - "false"
   *
   * Because query parameters are received as strings,
   * this property is validated using IsBooleanString().
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  /** Includes soft-deleted users when explicitly requested by an admin. */
  @IsOptional()
  @IsBooleanString()
  includeDeleted?: string;
}
