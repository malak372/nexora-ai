import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { SettingsService } from './settings.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for managing system settings.
 *
 * Provides admin-only endpoints for:
 * - Retrieving current system settings.
 * - Updating credit price and bonus credit rules.
 *
 * Base route:
 * /admin/settings
 *
 * @author Malak
 */
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Retrieves the current system settings.
   *
   * Endpoint:
   * GET /admin/settings
   *
   * @returns Current system settings.
   */
  @Get()
  getSystemSettings() {
    return this.settingsService.getSystemSettings();
  }

  /**
   * Updates the system settings.
   *
   * Endpoint:
   * PATCH /admin/settings
   *
   * @param body - DTO containing updated system settings.
   * @param currentUser - Authenticated administrator.
   * @returns Updated system settings or no-change result.
   */
  @Patch()
  updateSystemSettings(
    @Body() body: UpdateSystemSettingsDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.settingsService.updateSystemSettings(currentUser.id, body);
  }
}
