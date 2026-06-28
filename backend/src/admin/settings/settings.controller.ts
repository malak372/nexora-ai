import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SettingsService } from './settings.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Controller responsible for managing system settings.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve the current system settings.
 * - Update global system configuration values.
 *
 * The managed settings include values such as:
 * - Credit price.
 * - Bonus credit threshold.
 * - Bonus credits awarded.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
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
  /**
   * Creates an instance of SettingsController.
   *
   * @param settingsService - Service responsible for system settings management.
   */
  constructor(private readonly settingsService: SettingsService) { }

  /**
   * Retrieves the current system settings.
   *
   * Endpoint:
   * GET /admin/settings
   *
   * Returns the latest system configuration stored in the database.
   *
   * @returns The current system settings.
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
   * Request body example:
   * {
   *   "creditPrice": 15,
   *   "bonusThreshold": 10,
   *   "bonusCredits": 1
   * }
   *
   * The authenticated administrator's ID is passed to the
   * service layer to record who performed the update.
   *
   * @param body - DTO containing the updated system settings.
   * @param currentUser - The currently authenticated administrator.
   * @returns A success message and the updated system settings.
   */
  @Patch()
  updateSystemSettings(
    @Body() body: UpdateSystemSettingsDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.settingsService.updateSystemSettings(currentUser.id, body);
  }
}