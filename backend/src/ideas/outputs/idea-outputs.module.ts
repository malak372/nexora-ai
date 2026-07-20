import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromptsModule } from '../../prompts/prompts.module';

import { IdeaGenerationModule } from '../generation/idea-generation.module';

import { IdeaOutputsController } from './controllers/idea-outputs.controller';
import { IdeaOutputPersistenceService } from './services/idea-output-persistence.service';
import { IdeaOutputsService } from './services/idea-outputs.service';
import { IdeaUnlockService } from './services/idea-unlock.service';

/**
 * Generated-output and direct-unlock bounded-context module.
 *
 * Owns:
 * - Reading generated advanced outputs.
 * - Generating advanced outputs after a successful direct payment.
 * - Persisting unlock outputs atomically with the idea unlock state.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    PromptsModule,
    IdeaGenerationModule,
  ],
  controllers: [IdeaOutputsController],
  providers: [
    IdeaOutputsService,
    IdeaOutputPersistenceService,
    IdeaUnlockService,
  ],
  exports: [
    IdeaOutputsService,
    IdeaOutputPersistenceService,
    IdeaUnlockService,
  ],
})
export class IdeaOutputsModule {}