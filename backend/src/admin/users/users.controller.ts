import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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

/**
 * Controller responsible for administrative user management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve all users.
 * - Search and filter users.
 * - View detailed information about a specific user.
 * - Activate or deactivate user accounts.
 * - Soft delete user accounts.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
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
  constructor(private readonly usersService: UsersService) { }

  /**
   * Retrieves all users with optional search and filtering.
   *
   * Endpoint:
   * GET /admin/users
   *
   * This read-only endpoint is not recorded in audit logs.
   *
   * @param query - Query parameters used for searching and filtering users.
   * @returns A list of users with summary information and related statistics.
   */
  @Get()
  getUsers(@Query() query: GetUsersQueryDto) {
    return this.usersService.getUsers(query);
  }

  /**
   * Retrieves detailed information about a specific user.
   *
   * Endpoint:
   * GET /admin/users/:id
   *
   * This read-only endpoint is not recorded in audit logs.
   *
   * @param id - The unique identifier of the user.
   * @returns The selected user's complete information.
   */
  @Get(':id')
  getUserById(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  /**
   * Updates the active status of a user account.
   *
   * Endpoint:
   * PATCH /admin/users/:id/status
   *
   * @param id - The unique identifier of the user.
   * @param body - DTO containing the new active status.
   * @param currentUser - The authenticated administrator.
   * @returns A success message and the updated user information.
   */
  @Patch(':id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.usersService.updateUserStatus(
      id,
      body.isActive,
      currentUser.id,
    );
  }

  /**
   * Soft deletes a user account.
   *
   * Endpoint:
   * DELETE /admin/users/:id
   *
   * This operation deactivates the user without permanently
   * removing the record from the database.
   *
   * @param id - The unique identifier of the user.
   * @param currentUser - The authenticated administrator.
   * @returns A success message and the updated user information.
   */
  @Delete(':id')
  softDeleteUser(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.usersService.softDeleteUser(id, currentUser.id);
  }
}