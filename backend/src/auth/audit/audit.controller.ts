import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../decorators/roles.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';

import { AuthAuditService } from './audit.service';

/**
 * Exposes administrator-only endpoints for retrieving
 * authentication audit logs.
 *
 * Base route:
 * GET /admin/auth-audit-logs
 *
 * Access:
 * - Authenticated users only.
 * - Administrator role required.
 *
 * @author Eman
 */
@Controller('admin/auth-audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuthAuditController {
  constructor(
    private readonly authAuditService: AuthAuditService,
  ) { }

  /**
   * Retrieves the latest authentication audit logs.
   *
   * Endpoint:
   * GET /admin/auth-audit-logs
   *
   * @returns Authentication audit logs ordered by the service.
   */
  @Get()
  getLogs() {
    return this.authAuditService.getLogs();
  }
}
