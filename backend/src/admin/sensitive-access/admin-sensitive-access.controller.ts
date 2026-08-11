import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AdministratorsService } from '../administrators/administrators.service';
import { SettingsService } from '../settings/settings.service';
import { AdminSensitiveAccessService } from './admin-sensitive-access.service';
import {
  AdminSensitiveScope,
  VerifyAdminSensitiveAccessDto,
} from './dto/verify-admin-sensitive-access.dto';

type CurrentAdmin = {
  id: string;
  role: UserRole;
};

@Controller('admin/sensitive-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSensitiveAccessController {
  constructor(
    private readonly sensitiveAccessService: AdminSensitiveAccessService,
    private readonly administratorsService: AdministratorsService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verify(
    @Body() dto: VerifyAdminSensitiveAccessDto,
    @CurrentUser() currentAdmin: CurrentAdmin,
  ) {
    const access = await this.sensitiveAccessService.verifyPassword(
      currentAdmin.id,
      dto.password,
      dto.scope,
    );

    if (dto.scope === AdminSensitiveScope.ADMINISTRATORS) {
      const workspace = await this.administratorsService.getWorkspace(
        currentAdmin.id,
      );

      return {
        ...access,
        workspace,
      };
    }

    if (dto.scope === AdminSensitiveScope.SYSTEM_SETTINGS) {
      const settings = await this.settingsService.getSystemSettings();

      return {
        ...access,
        settings,
      };
    }

    return access;
  }
}