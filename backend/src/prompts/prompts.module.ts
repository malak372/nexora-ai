import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { PromptsController } from './prompts.controller';

import { PromptBuilderService } from './services/prompt-builder.service';
import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';

/**
 * Provides prompt-building, template-management,
 * and prompt-history services.
 *
 * Responsibilities:
 * - Build provider-neutral AI prompts.
 * - Manage configurable prompt templates.
 * - Persist prompt history.
 * - Audit administrator template changes.
 *
 * This module does not:
 * - Call AI providers.
 * - Generate or persist ideas.
 * - Process payments.
 * - Deduct credits.
 * - Execute NLP analysis.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule],

  controllers: [PromptsController],

  providers: [
    PromptBuilderService,
    PromptTemplateService,
    PromptHistoryService,
  ],

  exports: [PromptBuilderService, PromptTemplateService, PromptHistoryService],
})
export class PromptsModule {}
