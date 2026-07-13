import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminComplaintsController } from './controllers/admin-complaints.controller';
import { UserComplaintsController } from './controllers/user-complaints.controller';

import { AdminComplaintsService } from './services/admin-complaints.service';
import { UserComplaintsService } from './services/user-complaints.service';

/**
 * Shared complaints domain module.
 *
 * Provides:
 * - User complaint submission and retrieval.
 * - Administrator complaint management.
 * - Complaint analytics and CSV export.
 * - Audit logging.
 * - Complaint-related cache invalidation.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,

    /**
     * Remove this local registration when CacheModule
     * is already configured globally in AppModule.
     */
    CacheModule.register(),
  ],

  controllers: [UserComplaintsController, AdminComplaintsController],

  providers: [UserComplaintsService, AdminComplaintsService],
})
export class ComplaintsModule {}
