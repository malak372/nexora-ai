import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { AuditModule } from '../audit-logs/audit-logs.module';

import { CreditsModule } from '../credits/credits.module';

import { DataCollectionModule } from '../data collection/data-collection.module';

import { NlpModule } from '../nlp/nlp.module';

import { PrismaModule } from '../prisma/prisma.module';

import { PromptsModule } from '../prompts/prompts.module';

import { UsersModule } from '../users/users.module';

import { AdminIdeasController } from './controllers/admin-ideas.controller';

import { IdeaGenerationController } from './controllers/idea-generation.controller';

import { UserIdeasController } from './controllers/user-ideas.controller';

import { AdminIdeasService } from './services/admin-ideas.service';

import { CollectionJobResolverService } from './services/collection-job-resolver.service';

import { GuestIdeaSessionService } from './services/guest-idea-session.service';

import { IdeaAiOutputParserService } from './services/idea-ai-output-parser.service';

import { IdeaDuplicateDetectionService } from './services/idea-duplicate-detection.service';

import { IdeaGenerationLockService } from './services/idea-generation-lock.service';

import { IdeaGenerationOrchestratorService } from './services/idea-generation-orchestrator.service';

import { IdeaGenerationPolicyService } from './services/idea-generation-policy.service';

import { IdeaGenerationSelectionService } from './services/idea-generation-selection.service';

import { IdeaOutputMapperService } from './services/idea-output-mapper.service';

import { IdeaPersistenceService } from './services/idea-persistence.service';

import { UserIdeasService } from './services/user-ideas.service';

/**
 * Ideas domain module.
 *
 * Responsibilities:
 * - Guest idea generation.
 * - Registered free-tier generation.
 * - Premium-credit generation.
 * - Domain and platform validation.
 * - Data collection integration.
 * - NLP integration.
 * - Prompt construction.
 * - AI execution.
 * - Atomic entitlement consumption.
 * - Idea and advanced-output persistence.
 * - User and administrator idea retrieval.
 *
 * Direct-payment unlock remains owned by payment fulfillment and
 * will be integrated separately.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,

    AuditModule,

    CreditsModule,

    DataCollectionModule,

    NlpModule,

    PromptsModule,

    AiModule,

    UsersModule,
  ],

  controllers: [
    AdminIdeasController,

    UserIdeasController,

    IdeaGenerationController,
  ],

  providers: [
    AdminIdeasService,

    UserIdeasService,

    IdeaGenerationPolicyService,

    GuestIdeaSessionService,

    IdeaGenerationLockService,

    IdeaGenerationSelectionService,

    CollectionJobResolverService,

    IdeaAiOutputParserService,

    IdeaDuplicateDetectionService,

    IdeaOutputMapperService,

    IdeaPersistenceService,

    IdeaGenerationOrchestratorService,
  ],

  exports: [
    AdminIdeasService,

    UserIdeasService,

    IdeaGenerationOrchestratorService,
  ],
})
export class IdeasModule {}
