import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiModelHealthService } from './ai-model-health.service';
import { AiModelRoutingService } from './ai-model-routing.service';
import { AiModelsController } from './ai-models.controller';
import { AiModelsService } from './ai-models.service';

/**
 * AI Models module.
 *
 * Provides three separated responsibilities:
 *
 * AiModelsService:
 * - Administrative model configuration.
 * - Activation and deactivation.
 * - Default-model management.
 * - Model lookup.
 *
 * AiModelHealthService:
 * - Runtime success tracking.
 * - Runtime failure tracking.
 * - Health-state calculation.
 *
 * AiModelRoutingService:
 * - Default model routing.
 * - Lowest-cost routing.
 * - Balanced weighted routing.
 *
 * These services are exported so the central AiModule and provider
 * adapters can resolve models and update operational health.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule],

  controllers: [AiModelsController],

  providers: [AiModelsService, AiModelHealthService, AiModelRoutingService],

  exports: [AiModelsService, AiModelHealthService, AiModelRoutingService],
})
export class AiModelsModule {}
