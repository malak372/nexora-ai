import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { PromptsController } from './prompts.controller';
import { PromptBuilderService } from './services/prompt-builder.service';
import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';

/**
 * Prompts module.
 *
 * Responsibilities:
 * - Build AI prompts from database records.
 * - Manage configurable prompt templates.
 * - Store prompt history for auditing and debugging.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],
  controllers: [PromptsController],
  providers: [
    PromptBuilderService,
    PromptHistoryService,
    PromptTemplateService,
  ],
  exports: [
    PromptBuilderService,
    PromptHistoryService,
    PromptTemplateService,
  ],
})
export class PromptsModule {}