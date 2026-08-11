import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../decorators/roles.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';

import { AuthAuditService } from './audit.service';
import { GetAuthAuditQueryDto } from '../dto/get-auth-audit-query.dto';

/**
 * Administrator-only authentication security endpoints.
 *
 * @author Eman
 */
@Controller('admin/auth-audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuthAuditController {
  constructor(private readonly authAuditService: AuthAuditService) {}

  /**
   * GET /admin/auth-audit-logs/summary
   */
  @Get('summary')
  getSummary(@Query() query: GetAuthAuditQueryDto) {
    return this.authAuditService.getSummary(query);
  }

  /**
   * GET /admin/auth-audit-logs
   */
  @Get()
  getLogs(@Query() query: GetAuthAuditQueryDto) {
    return this.authAuditService.getLogs(query);
  }
}