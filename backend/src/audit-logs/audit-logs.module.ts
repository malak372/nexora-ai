import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuditController } from './audit-logs.controller';
import { AuditService } from './audit-logs.service';

/**
 * Shared audit module.
 *
 * Provides:
 * - AuditService for writing and reading audit logs.
 * - AuditController for admin-only audit log endpoints.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}