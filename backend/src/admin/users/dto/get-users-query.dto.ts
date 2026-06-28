import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AccountStatus, UserRole } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating users
 * in the Admin User Management module.
 *
 * This DTO is used with the GET /admin/users endpoint.
 * It extends PaginationQueryDto to support pagination
 * while providing additional filtering and searching options.
 *
 * Supported features:
 * - Pagination.
 * - Search by user name or email.
 * - Filter by user role.
 * - Filter by account status.
 * - Filter by active/inactive state.
 *
 * All filter properties are optional, allowing the administrator
 * to retrieve all users or apply one or more filters.
 *
 * Example:
 * GET /admin/users?page=1&limit=10&search=malak&role=USER&accountStatus=NORMAL&isActive=true
 *
 * @author Malak
 */
export class GetUsersQueryDto extends ListQueryDto {
  /**
   * Optional search keyword.
   *
   * Used to search users by full name or email address.
   *
   * Example:
   * malak
   */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Optional user role filter.
   *
   * Must be one of the values defined in the UserRole enum.
   *
   * Example:
   * USER
   */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /**
   * Optional account status filter.
   *
   * Must be one of the values defined in the AccountStatus enum.
   *
   * Example:
   * NORMAL
   */
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  /**
   * Optional active status filter.
   *
   * Since query parameters are received as strings,
   * accepted values are:
   * - "true"  -> Active users.
   * - "false" -> Inactive users.
   */
  @IsOptional()
  @IsString()
  isActive?: string;
}