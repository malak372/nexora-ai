import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AdminSensitiveAccessService } from '../sensitive-access/admin-sensitive-access.service';
import { AdminSensitiveScope } from '../sensitive-access/dto/verify-admin-sensitive-access.dto';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { SettingsService } from './settings.service';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly sensitiveAccessService: AdminSensitiveAccessService,
  ) {}

  @Get()
  getSystemSettings(
    @CurrentUser() currentUser: AuthenticatedAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentUser.id, sensitiveToken);
    return this.settingsService.getSystemSettings();
  }

  @Patch()
  updateSystemSettings(
    @Body() body: UpdateSystemSettingsDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentUser.id, sensitiveToken);
    return this.settingsService.updateSystemSettings(currentUser.id, body);
  }

  private assertSensitiveAccess(
    adminId: string,
    sensitiveToken?: string,
  ) {
    this.sensitiveAccessService.assertAccess(
      sensitiveToken,
      adminId,
      AdminSensitiveScope.SYSTEM_SETTINGS,
    );
  }
}