import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { PromptsController } from './prompts.controller';
import { PromptBuilderService } from './services/prompt-builder.service';
import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';

/**
 * Provides all services required for AI prompt management.
 *
 * Responsibilities:
 * - Build AI prompts from persisted NLP analysis.
 * - Manage configurable AI prompt templates.
 * - Persist prompt history for auditing and debugging.
 * - Expose prompt services to feature modules such as Ideas.
 *
 * This module does not:
 * - Call AI providers.
 * - Generate ideas.
 * - Process payments.
 * - Execute NLP analysis.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],

  controllers: [PromptsController],

  providers: [
    PromptBuilderService,
    PromptTemplateService,
    PromptHistoryService,
  ],

  exports: [
    PromptBuilderService,
    PromptTemplateService,
    PromptHistoryService,
  ],
})
export class PromptsModule {}