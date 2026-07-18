import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiModelHealthService } from './ai-model-health.service';
import { AiModelRoutingService } from './ai-model-routing.service';
import { AiModelsController } from './ai-models.controller';
import { AiModelsService } from './ai-models.service';

/**
 * Module responsible for AI-model configuration, routing, and health
 * management.
 *
 * Responsibilities are separated across the following services:
 *
 * AiModelsService:
 * - Creates and updates AI-model configurations.
 * - Activates and deactivates models.
 * - Selects and manages the default model.
 * - Retrieves configured, routable, and fallback models.
 * - Persists administrative audit records.
 *
 * AiModelHealthService:
 * - Records successful model executions.
 * - Records failed model executions.
 * - Updates consecutive-failure counters.
 * - Transitions model health between UNKNOWN, HEALTHY, DEGRADED,
 *   and UNAVAILABLE.
 * - Resets operational health when required.
 *
 * AiModelRoutingService:
 * - Resolves the model execution order.
 * - Supports default-first routing.
 * - Supports lowest-estimated-cost routing.
 * - Supports balanced weighted routing.
 *
 * Imported modules:
 *
 * PrismaModule:
 * - Provides PrismaService for AI-model persistence and transactions.
 *
 * AuditModule:
 * - Provides AuditService for administrative model-change logging.
 *
 * Exported services are available to other modules, especially the
 * central AiModule, so runtime AI execution can:
 * - Resolve eligible models.
 * - Apply routing strategies.
 * - Record execution success or failure.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
  ],

  controllers: [
    AiModelsController,
  ],

  providers: [
    AiModelsService,
    AiModelHealthService,
    AiModelRoutingService,
  ],

  exports: [
    AiModelsService,
    AiModelHealthService,
    AiModelRoutingService,
  ],
})
export class AiModelsModule {}