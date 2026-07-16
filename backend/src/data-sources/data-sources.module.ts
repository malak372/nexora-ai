import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { CollectorsModule } from '../collectors/collectors.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminDataSourcesController } from './controllers/admin-data-sources.controller';
import { DataSourcesController } from './controllers/data-sources.controller';
import { DataSourcesService } from './data-sources.service';

/**
 * Module responsible for data-source configuration,
 * administration, availability, and collector-registry
 * synchronization.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule, CollectorsModule],

  controllers: [AdminDataSourcesController, DataSourcesController],

  providers: [DataSourcesService],

  exports: [DataSourcesService],
})
export class DataSourcesModule {}
