import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import { AdminPublicationModerationDto } from '../dto/admin-publication-moderation.dto';
import { AdminPublicationModerationService } from '../services/admin-publication-moderation.service';

@Controller('admin/publications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPublicationModerationController {
  constructor(private readonly service: AdminPublicationModerationService) {}

  @Patch(':publicationId/hide')
  hide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' }))
    publicationId: string,
    @Body() dto: AdminPublicationModerationDto,
  ) {
    return this.service.hide(admin.id, publicationId, dto);
  }

  @Patch(':publicationId/restore')
  restore(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' }))
    publicationId: string,
  ) {
    return this.service.restore(admin.id, publicationId);
  }

  @Patch(':publicationId/archive')
  archive(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' }))
    publicationId: string,
    @Body() dto: AdminPublicationModerationDto,
  ) {
    return this.service.archive(admin.id, publicationId, dto);
  }
}
