import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiModelsModule } from '../ai-models/ai-models.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiUsageAnalyticsController } from './analytics/ai-usage-analytics.controller';
import { AiUsageAnalyticsService } from './analytics/ai-usage-analytics.service';

import { GoogleProvider } from './providers/google.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

import { AiExecutionService } from './services/ai-execution.service';
import { AiProviderCredentialsService } from './services/ai-provider-credentials.service';
import { AiProviderFactoryService } from './services/ai-provider-factory.service';
import { AiResponseParserService } from './services/ai-response-parser.service';
import { AiResponseRepairService } from './services/ai-response-repair.service';
import { AiStructuredOutputService } from './services/ai-structured-output.service';
import { AiTimeoutService } from './services/ai-timeout.service';
import { ExternalAiLogService } from './services/external-ai-log.service';

/**
 * Central AI runtime module.
 *
 * Registered providers:
 * - Google AI.
 * - OpenRouter.
 *
 * Responsibilities:
 * - Register provider adapters.
 * - Register central AI execution services.
 * - Register AI analytics.
 * - Integrate AI model routing and health management.
 *
 * Provider credentials are read from environment variables and are
 * never stored inside AiModel records.
 *
 * @author Malak
 */
@Module({
  imports: [ConfigModule, PrismaModule, AiModelsModule],

  controllers: [AiUsageAnalyticsController],

  providers: [
    /**
     * External provider adapters.
     */
    GoogleProvider,
    OpenRouterProvider,

    /**
     * Provider registry and credentials.
     */
    AiProviderCredentialsService,
    AiProviderFactoryService,

    /**
     * Execution infrastructure.
     */
    AiTimeoutService,
    ExternalAiLogService,

    /**
     * Structured-output parsing, validation, and repair.
     */
    AiResponseParserService,
    AiStructuredOutputService,
    AiResponseRepairService,

    /**
     * Main AI runtime and analytics services.
     */
    AiExecutionService,
    AiUsageAnalyticsService,
  ],

  exports: [
    /**
     * Used by business modules to execute AI operations.
     */
    AiExecutionService,

    /**
     * Useful for provider availability and registry checks.
     */
    AiProviderFactoryService,

    /**
     * Exposed for modules that need independent response processing.
     */
    AiResponseParserService,
    AiStructuredOutputService,

    /**
     * Exposed for administrator analytics integrations.
     */
    AiUsageAnalyticsService,
  ],
})
export class AiModule {}
