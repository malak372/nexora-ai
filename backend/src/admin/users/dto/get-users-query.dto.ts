import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';
import { AccountStatus, UserRole } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating users.
 *
 * This DTO is used by the Admin User Management module to retrieve
 * user records with optional filtering capabilities.
 *
 * It extends ListQueryDto to inherit:
 * - Pagination.
 * - Search.
 * - Date range filtering.
 * - Sorting.
 *
 * Supported filters:
 * - User role.
 * - Account status.
 * - Active/inactive state.
 *
 * Used by:
 * - GET /admin/users
 * - GET /admin/users/summary
 * - GET /admin/users/charts
 *
 * Example:
 * GET /admin/users?page=1
 *   &limit=10
 *   &search=malak
 *   &role=USER
 *   &accountStatus=NORMAL
 *   &isActive=true
 *   &sortBy=createdAt
 *   &sortOrder=desc
 *
 * @author Malak
 */
export class GetUsersQueryDto extends ListQueryDto {
  /**
   * Optional user role filter.
   *
   * When provided, only users with the specified role
   * are included in the results.
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
   * Returns only users whose account matches
   * the specified account status.
   */
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  /**
   * Optional active status filter.
   *
   * Accepted values:
   * - true
   * - false
   *
   * Because query parameters are received as strings,
   * this property is validated using IsBooleanString().
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}