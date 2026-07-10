import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthAuditService } from './audit.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';

/**
 * Controller responsible for viewing authentication audit logs.
 *
 * Base route:
 * /admin/auth-audit-logs
 *
 * @author Eman
 */
@Controller('admin/auth-audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuthAuditController {
  constructor(private readonly authAuditService: AuthAuditService) {}

  /**
   * Returns the latest authentication audit logs.
   *
   * Endpoint:
   * GET /admin/auth-audit-logs
   */
  @Get()
  getLogs() {
    return this.authAuditService.getLogs();
  }
}
