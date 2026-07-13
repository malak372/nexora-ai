import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiModelsModule } from '../ai-models/ai-models.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiUsageAnalyticsController } from './analytics/ai-usage-analytics.controller';
import { AiUsageAnalyticsService } from './analytics/ai-usage-analytics.service';

import { OpenRouterProvider } from './providers/openrouter.provider';
import { GoogleProvider } from './providers/google.provider';
import { GroqProvider } from './providers/groq.provider';

import { AiExecutionService } from './services/ai-execution.service';
import { AiProviderCredentialsService } from './services/ai-provider-credentials.service';
import { AiProviderFactoryService } from './services/ai-provider-factory.service';
import { AiResponseParserService } from './services/ai-response-parser.service';
import { AiResponseRepairService } from './services/ai-response-repair.service';
import { AiStructuredOutputService } from './services/ai-structured-output.service';
import { AiTimeoutService } from './services/ai-timeout.service';
import { ExternalAiLogService } from './services/external-ai-log.service';

/**
 * Runtime AI integration module.
 *
 * This module contains the infrastructure required to execute AI
 * requests through configured external providers and expose
 * administrative AI-usage analytics.
 *
 * Responsibilities:
 * - Register Google, Groq, and OpenRouter provider adapters.
 * - Resolve provider credentials from application configuration.
 * - Select the appropriate provider adapter at runtime.
 * - Execute AI requests with timeout protection.
 * - Apply same-model retries and cross-model fallback.
 * - Validate structured AI output.
 * - Repair malformed structured output once before fallback.
 * - Persist one external API log for every provider call.
 * - Expose usage, cost, latency, error, and fallback analytics.
 *
 * Administrative AI-model CRUD and model configuration remain
 * inside AiModelsModule.
 *
 * This module does not:
 * - Build original idea prompts.
 * - Persist generated Idea records.
 * - Deduct user credits.
 * - Manage AI-model CRUD endpoints.
 *
 * @author Malak
 */
@Module({
  imports: [ConfigModule, PrismaModule, AiModelsModule],

  controllers: [AiUsageAnalyticsController],

  providers: [
    /**
     * Concrete external AI provider adapters.
     */
    GoogleProvider,
    GroqProvider,
    OpenRouterProvider,

    /**
     * Provider infrastructure services.
     */
    AiProviderCredentialsService,
    AiProviderFactoryService,

    /**
     * Execution-support services.
     */
    AiTimeoutService,
    ExternalAiLogService,

    /**
     * Response-processing services.
     */
    AiResponseParserService,
    AiStructuredOutputService,
    AiResponseRepairService,

    /**
     * Main AI runtime orchestrator.
     */
    AiExecutionService,

    /**
     * Administrative AI usage analytics.
     */
    AiUsageAnalyticsService,
  ],

  exports: [
    AiExecutionService,
    AiResponseParserService,
    AiStructuredOutputService,
    AiUsageAnalyticsService,
  ],
})
export class AiModule {}
