import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { BusinessModelTemplatesModule } from '../../business-model-templates/business-model-templates.module';
import { PrismaModule } from '../../prisma/prisma.module';

import { IdeaBusinessModelsController } from './controller/idea-business-models.controller';
import { IdeaBusinessModelsService } from './services/idea-business-models.service';

/**
 * Configures post-generation business-model selection, generation,
 * versioning, preview, and download.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AiModule, BusinessModelTemplatesModule],
  controllers: [IdeaBusinessModelsController],
  providers: [IdeaBusinessModelsService],
  exports: [IdeaBusinessModelsService],
})
export class IdeaBusinessModelsModule {}
