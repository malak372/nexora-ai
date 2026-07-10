import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiModelsController } from './ai-models.controller';
import { AiModelsService } from './ai-models.service';

/**
 * AI Models module.
 *
 * Provides:
 * - Admin AI model management endpoints.
 * - Default model resolution.
 * - Active model management.
 * - Fallback model lookup.
 * - Administrative audit logging.
 *
 * Other modules may inject AiModelsService to resolve
 * the currently active default model.
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
  ],
  exports: [
    AiModelsService,
  ],
})
export class AiModelsModule {}