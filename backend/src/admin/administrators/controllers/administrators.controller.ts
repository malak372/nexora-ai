import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { AdminSensitiveAccessService } from '../../sensitive-access/admin-sensitive-access.service';
import { AdminSensitiveScope } from '../../sensitive-access/dto/verify-admin-sensitive-access.dto';
import { AdministratorsService } from '../administrators.service';
import { CreateAdminInvitationDto } from '../dto/create-admin-invitation.dto';

type CurrentAdmin = {
  id: string;
  role: UserRole;
};

@Controller('admin/administrators')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdministratorsController {
  constructor(
    private readonly administratorsService: AdministratorsService,
    private readonly sensitiveAccessService: AdminSensitiveAccessService,
  ) {}

  @Get()
  getWorkspaceRoot(
    @CurrentUser() currentAdmin: CurrentAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentAdmin.id, sensitiveToken);
    return this.administratorsService.getWorkspace(currentAdmin.id);
  }

  @Get('workspace')
  getWorkspace(
    @CurrentUser() currentAdmin: CurrentAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentAdmin.id, sensitiveToken);
    return this.administratorsService.getWorkspace(currentAdmin.id);
  }

  @Post('invitations')
  invite(
    @Body() dto: CreateAdminInvitationDto,
    @CurrentUser() currentAdmin: CurrentAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentAdmin.id, sensitiveToken);
    return this.administratorsService.invite(dto, currentAdmin.id);
  }

  @Post('invitations/:id/resend')
  resend(
    @Param('id', ParseUUIDPipe) invitationId: string,
    @CurrentUser() currentAdmin: CurrentAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentAdmin.id, sensitiveToken);
    return this.administratorsService.resend(
      invitationId,
      currentAdmin.id,
    );
  }

  @Delete('invitations/:id')
  cancel(
    @Param('id', ParseUUIDPipe) invitationId: string,
    @CurrentUser() currentAdmin: CurrentAdmin,
    @Headers('x-admin-sensitive-token') sensitiveToken?: string,
  ) {
    this.assertSensitiveAccess(currentAdmin.id, sensitiveToken);
    return this.administratorsService.cancel(invitationId);
  }

  private assertSensitiveAccess(
    adminId: string,
    sensitiveToken?: string,
  ) {
    this.sensitiveAccessService.assertAccess(
      sensitiveToken,
      adminId,
      AdminSensitiveScope.ADMINISTRATORS,
    );
  }
}