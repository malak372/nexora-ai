import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminDomainsController } from './controllers/admin-domains.controller';
import { DomainsController } from './controllers/domains.controller';
import { DomainsService } from './domains.service';

/**
 * Provides domain administration and user-facing domain discovery.
 *
 * Administrative endpoints are exposed under:
 * /admin/domains
 *
 * User-facing discovery endpoints are exposed under:
 * /domains
 *
 * @author Eman
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AdminDomainsController, DomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
