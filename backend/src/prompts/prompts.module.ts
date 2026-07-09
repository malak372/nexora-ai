import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit-logs/audit-logs.module';

import { PromptsController } from './prompts.controller';
import { PromptBuilderService } from './services/prompt-builder.service';
import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';

/**
 * PromptsModule
 *
 * Central module responsible for managing all prompt-related features
 * in the system.
 *
 * This module groups together:
 * - Prompt template management
 * - Dynamic prompt building
 * - Prompt history tracking
 * - Admin prompt configuration endpoints
 *
 * It imports:
 * - PrismaModule: to allow prompt services to interact with the database.
 * - AuditModule: to record admin actions related to prompt updates.
 *
 * It exports the prompt services so they can be reused by other modules,
 * such as idea generation, AI chat, NLP analysis, and abstract generation.
 *
 * @module PromptsModule
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
  ],

  controllers: [
    /**
     * Exposes admin endpoints for viewing and updating prompt templates,
     * as well as retrieving prompt history records.
     */
    PromptsController,
  ],

  providers: [
    /**
     * Builds final AI prompts using system templates,
     * user input, idea context, NLP analysis results,
     * and selected generation type.
     */
    PromptBuilderService,

    /**
     * Handles storing and retrieving prompt execution history,
     * including generated prompt content, prompt type,
     * related user, idea, and metadata.
     */
    PromptHistoryService,

    /**
     * Manages the active prompt template stored in system settings,
     * including reading the current template and allowing admins
     * to update it safely.
     */
    PromptTemplateService,
  ],

  exports: [
    /**
     * Exported so other modules can generate structured AI prompts
     * without duplicating prompt construction logic.
     */
    PromptBuilderService,

    /**
     * Exported so other modules can save prompt usage history
     * after AI requests are executed.
     */
    PromptHistoryService,

    /**
     * Exported so other modules can access the current prompt template
     * when building AI requests.
     */
    PromptTemplateService,
  ],
})
export class PromptsModule {}