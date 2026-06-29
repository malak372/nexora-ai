import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { UsersService } from './users.service';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for administrative user management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve users with filtering, searching, sorting, and pagination.
 * - View user summary statistics.
 * - Retrieve user analytics for charts.
 * - Retrieve a single user by ID.
 * - Activate or deactivate user accounts.
 * - Send password reset emails.
 * - Soft delete user accounts.
 *
 * All endpoints are protected by JWT authentication
 * and require the ADMIN role.
 *
 * Base route:
 * /admin/users
 *
 * @author Malak
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Retrieves a paginated list of users.
   *
   * Supports:
   * - Pagination.
   * - Searching.
   * - Sorting.
   * - Date filtering.
   * - Role filtering.
   * - Account status filtering.
   * - Active status filtering.
   *
   * GET /admin/users
   *
   * @param query User filtering and pagination options.
   * @returns Paginated list of users.
   */
  @Get()
  getUsers(@Query() query: GetUsersQueryDto) {
    return this.usersService.getUsers(query);
  }

  /**
   * Retrieves summary statistics for users.
   *
   * The same filters used by the users list
   * can also be applied to the summary.
   *
   * GET /admin/users/summary
   *
   * @param query Optional filtering parameters.
   * @returns User summary statistics.
   */
  @Get('summary')
  getUsersSummary(@Query() query: GetUsersQueryDto) {
    return this.usersService.getUsersSummary(query);
  }

  /**
   * Retrieves analytics data used by dashboard charts.
   *
   * The returned statistics respect the same
   * filtering options available for the users list.
   *
   * GET /admin/users/charts
   *
   * @param query Optional filtering parameters.
   * @returns User analytics for charts.
   */
  @Get('charts')
  getUsersCharts(@Query() query: GetUsersQueryDto) {
    return this.usersService.getUsersCharts(query);
  }

  /**
   * Retrieves a specific user by ID.
   *
   * GET /admin/users/:id
   *
   * @param id User unique identifier.
   * @returns User details.
   */
  @Get(':id')
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getUserById(id);
  }

  /**
   * Updates a user's active status.
   *
   * Allows administrators to activate
   * or deactivate user accounts.
   *
   * PATCH /admin/users/:id/status
   *
   * @param id User unique identifier.
   * @param body Active status request body.
   * @param currentUser Authenticated administrator.
   * @returns Updated user information.
   */
  @Patch(':id/status')
  updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserStatusDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.usersService.updateUserStatus(
      id,
      body.isActive,
      currentUser.id,
    );
  }

  /**
   * Sends a password reset email to a user.
   *
   * The email contains a secure password reset link
   * allowing the user to create a new password.
   *
   * POST /admin/users/:id/send-password-reset-email
   *
   * @param id User unique identifier.
   * @param currentUser Authenticated administrator.
   * @returns Success confirmation.
   */
  @Post(':id/send-password-reset-email')
  sendPasswordResetEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.usersService.sendPasswordResetEmail(
      id,
      currentUser.id,
    );
  }

  /**
   * Soft deletes a user account.
   *
   * The user record remains in the database,
   * but is marked as deleted and becomes inactive.
   *
   * DELETE /admin/users/:id
   *
   * @param id User unique identifier.
   * @param currentUser Authenticated administrator.
   * @returns Success confirmation.
   */
  @Delete(':id')
  softDeleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.usersService.softDeleteUser(id, currentUser.id);
  }
}