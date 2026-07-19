import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { CreditsModule } from '../credits/credits.module';

import { DataCollectionModule } from '../data collection/data-collection.module';

import { NlpModule } from '../nlp/nlp.module';

import { PrismaModule } from '../prisma/prisma.module';

import { PromptsModule } from '../prompts/prompts.module';

import { GuestIdeaGenerationController } from './generation/controllers/guest-idea-generation.controller';

import { IdeaGenerationRunsController } from './generation/controllers/idea-generation-runs.controller';

import { UserIdeaGenerationController } from './generation/controllers/user-idea-generation.controller';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
  type IdeaGenerationStageKey,
} from './generation/constants/idea-generation-stages.constants';

import type { IdeaGenerationStage } from './generation/interfaces/idea-generation-stage.interface';

import { IdeaGenerationCancellationService } from './generation/pipeline/idea-generation-cancellation.service';

import { IdeaGenerationPipelineService } from './generation/pipeline/idea-generation-pipeline.service';

import { IdeaGenerationProgressService } from './generation/pipeline/idea-generation-progress.service';

import { IdeaGenerationStageService } from './generation/pipeline/idea-generation-stage.service';

import { AiOutputValidationStage } from './generation/pipeline/stages/ai-output-validation.stage';

import { CollectionJobResolutionStage } from './generation/pipeline/stages/collection-job-resolution.stage';

import { CoreIdeaGenerationStage } from './generation/pipeline/stages/core-idea-generation.stage';

import { DataCollectionStage } from './generation/pipeline/stages/data-collection.stage';

import { DataSourceSelectionStage } from './generation/pipeline/stages/data-source-selection.stage';

import { DuplicateCheckStage } from './generation/pipeline/stages/duplicate-check.stage';

import { EntitlementCheckStage } from './generation/pipeline/stages/entitlement-check.stage';

import { FinalizationStage } from './generation/pipeline/stages/finalization.stage';

import { IdeaPersistenceStage } from './generation/pipeline/stages/idea-persistence.stage';

import { NlpAnalysisStage } from './generation/pipeline/stages/nlp-analysis.stage';

import {
  PremiumOutputGenerationStage,
  type PremiumOutputGenerationStageOptions,
} from './generation/pipeline/stages/premium-output-generation.stage';

import { PromptBuildingStage } from './generation/pipeline/stages/prompt-building.stage';

import { RequestValidationStage } from './generation/pipeline/stages/request-validation.stage';

import { CollectionJobResolverService } from './generation/services/collection-job-resolver.service';

import { GuestIdeaSessionService } from './generation/services/guest-idea-session.service';

import { IdeaAiOutputParserService } from './generation/services/idea-ai-output-parser.service';

import { IdeaDuplicateDetectionService } from './generation/services/idea-duplicate-detection.service';

import { IdeaGenerationLockService } from './generation/services/idea-generation-lock.service';

import {
  IDEA_GENERATION_STAGES,
  IdeaGenerationOrchestratorService,
} from './generation/services/idea-generation-orchestrator.service';

import { IdeaGenerationPolicyService } from './generation/services/idea-generation-policy.service';

import { IdeaGenerationRunService } from './generation/services/idea-generation-run.service';

import { IdeaGenerationSelectionService } from './generation/services/idea-generation-selection.service';

import { IdeaPersistenceService } from './generation/services/idea-persistence.service';

import { AdminIdeasController } from './management/admin/controllers/admin-ideas.controller';

import { AdminIdeasService } from './management/admin/services/admin-ideas.service';

import { UserIdeasController } from './management/user/controllers/user-ideas.controller';

import { UserIdeasService } from './management/user/services/user-ideas.service';

/**
 * Internal provider tokens used for individually configured
 * premium-output stage instances.
 *
 * Each premium output requires a separate stage instance because
 * every instance has:
 * - A different stage key.
 * - A different progress range.
 * - A different output key.
 * - A different display title.
 *
 * @author Malak
 */
const PREMIUM_STAGE_TOKENS = {
  FULL_ABSTRACT:
    Symbol(
      'PREMIUM_STAGE_FULL_ABSTRACT',
    ),

  TECHNOLOGY_STACK:
    Symbol(
      'PREMIUM_STAGE_TECHNOLOGY_STACK',
    ),

  SYSTEM_ARCHITECTURE:
    Symbol(
      'PREMIUM_STAGE_SYSTEM_ARCHITECTURE',
    ),

  DATABASE_DESIGN:
    Symbol(
      'PREMIUM_STAGE_DATABASE_DESIGN',
    ),

  BUSINESS_MODEL:
    Symbol(
      'PREMIUM_STAGE_BUSINESS_MODEL',
    ),

  BUDGET:
    Symbol(
      'PREMIUM_STAGE_BUDGET',
    ),

  TIMELINE:
    Symbol(
      'PREMIUM_STAGE_TIMELINE',
    ),

  FEASIBILITY:
    Symbol(
      'PREMIUM_STAGE_FEASIBILITY',
    ),

  MARKET_POTENTIAL:
    Symbol(
      'PREMIUM_STAGE_MARKET_POTENTIAL',
    ),

  REVENUE_MODEL:
    Symbol(
      'PREMIUM_STAGE_REVENUE_MODEL',
    ),

  LOCAL_REGULATIONS:
    Symbol(
      'PREMIUM_STAGE_LOCAL_REGULATIONS',
    ),
} as const;

/**
 * Complete configuration for one premium-output stage.
 *
 * @author Malak
 */
type PremiumStageRegistration = {
  token: symbol;

  stageKey: IdeaGenerationStageKey;

  outputKey: string;

  outputTitle: string;

  required?: boolean;
};

/**
 * Premium-output stage registrations.
 *
 * The output keys must match the keys returned by
 * IdeaAiOutputParserService and persisted through
 * IdeaPersistenceService.
 *
 * @author Malak
 */
const PREMIUM_STAGE_REGISTRATIONS:
  readonly PremiumStageRegistration[] = [
    {
      token:
        PREMIUM_STAGE_TOKENS
          .FULL_ABSTRACT,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .FULL_ABSTRACT_GENERATION,

      outputKey:
        'full-abstract',

      outputTitle:
        'Full abstract',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .TECHNOLOGY_STACK,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .TECHNOLOGY_STACK_GENERATION,

      outputKey:
        'technology-stack',

      outputTitle:
        'Technology stack',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .SYSTEM_ARCHITECTURE,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .SYSTEM_ARCHITECTURE_GENERATION,

      outputKey:
        'system-architecture',

      outputTitle:
        'System architecture',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .DATABASE_DESIGN,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .DATABASE_DESIGN_GENERATION,

      outputKey:
        'database-design',

      outputTitle:
        'Database design',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .BUSINESS_MODEL,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .BUSINESS_MODEL_GENERATION,

      outputKey:
        'business-model',

      outputTitle:
        'Business model',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .BUDGET,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .BUDGET_GENERATION,

      outputKey:
        'budget',

      outputTitle:
        'Budget',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .TIMELINE,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .TIMELINE_GENERATION,

      outputKey:
        'timeline',

      outputTitle:
        'Timeline',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .FEASIBILITY,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .FEASIBILITY_GENERATION,

      outputKey:
        'feasibility',

      outputTitle:
        'Feasibility',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .MARKET_POTENTIAL,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .MARKET_POTENTIAL_GENERATION,

      outputKey:
        'market-potential',

      outputTitle:
        'Market potential',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .REVENUE_MODEL,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .REVENUE_MODEL_GENERATION,

      outputKey:
        'revenue-model',

      outputTitle:
        'Revenue model',
    },

    {
      token:
        PREMIUM_STAGE_TOKENS
          .LOCAL_REGULATIONS,

      stageKey:
        IDEA_GENERATION_STAGE_KEYS
          .LOCAL_REGULATIONS_GENERATION,

      outputKey:
        'local-regulations',

      outputTitle:
        'Local regulations',
    },
  ] as const;

/**
 * Resolves one required generation-stage definition.
 *
 * Application startup fails immediately when the stage constants
 * are inconsistent with IdeasModule registration.
 *
 * @param stageKey Stable pipeline-stage key.
 * @returns Existing stage definition.
 */
function getRequiredStageDefinition(
  stageKey: IdeaGenerationStageKey,
): IdeaGenerationStageDefinition {
  const definition =
    findIdeaGenerationStageDefinition(
      stageKey,
    );

  if (!definition) {
    throw new Error(
      `Missing idea-generation stage definition for "${stageKey}".`,
    );
  }

  return definition;
}

/**
 * Creates the provider configuration for one premium-output
 * stage instance.
 *
 * @param registration Premium-stage registration.
 * @returns NestJS custom provider.
 */
function createPremiumStageProvider(
  registration: PremiumStageRegistration,
) {
  return {
    provide: registration.token,

    useFactory:
      (): PremiumOutputGenerationStage => {
        const options:
          PremiumOutputGenerationStageOptions = {
          definition:
            getRequiredStageDefinition(
              registration.stageKey,
            ),

          outputKey:
            registration.outputKey,

          outputTitle:
            registration.outputTitle,

          required:
            registration.required ??
            true,
        };

        return new PremiumOutputGenerationStage(
          options,
        );
      },
  };
}

/**
 * Root module for idea generation and idea management.
 *
 * Responsibilities:
 * - Register authenticated and guest generation controllers.
 * - Register generation-run monitoring and cancellation.
 * - Register all core generation services.
 * - Register all executable pipeline stages.
 * - Register individually configured premium-output stages.
 * - Provide the ordered stage collection to the orchestrator.
 * - Register user and administrator idea-management endpoints.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    NlpModule,
    PromptsModule,
    DataCollectionModule,
    CreditsModule,
  ],

  controllers: [
    GuestIdeaGenerationController,
    UserIdeaGenerationController,
    IdeaGenerationRunsController,

    UserIdeasController,
    AdminIdeasController,
  ],

  providers: [
    /**
     * Generation lifecycle and pipeline infrastructure.
     */
    IdeaGenerationRunService,
    IdeaGenerationProgressService,
    IdeaGenerationCancellationService,
    IdeaGenerationStageService,
    IdeaGenerationPipelineService,
    IdeaGenerationLockService,
    IdeaGenerationOrchestratorService,

    /**
     * Generation domain services.
     */
    GuestIdeaSessionService,
    IdeaGenerationPolicyService,
    IdeaGenerationSelectionService,
    CollectionJobResolverService,
    IdeaAiOutputParserService,
    IdeaDuplicateDetectionService,
    IdeaPersistenceService,

    /**
     * Core executable pipeline stages.
     */
    RequestValidationStage,
    EntitlementCheckStage,
    DataSourceSelectionStage,
    CollectionJobResolutionStage,
    DataCollectionStage,
    NlpAnalysisStage,
    PromptBuildingStage,
    CoreIdeaGenerationStage,
    AiOutputValidationStage,
    DuplicateCheckStage,
    IdeaPersistenceStage,
    FinalizationStage,

    /**
     * Configured premium-output stage instances.
     */
    ...PREMIUM_STAGE_REGISTRATIONS.map(
      createPremiumStageProvider,
    ),

    /**
     * Complete executable-stage registry injected into the
     * orchestrator.
     */
    {
      provide:
        IDEA_GENERATION_STAGES,

      inject: [
        RequestValidationStage,
        EntitlementCheckStage,
        DataSourceSelectionStage,
        CollectionJobResolutionStage,
        DataCollectionStage,
        NlpAnalysisStage,
        PromptBuildingStage,
        CoreIdeaGenerationStage,
        AiOutputValidationStage,
        DuplicateCheckStage,
        IdeaPersistenceStage,

        ...PREMIUM_STAGE_REGISTRATIONS.map(
          ({ token }) => token,
        ),

        FinalizationStage,
      ],

      useFactory: (
        requestValidationStage:
          RequestValidationStage,

        entitlementCheckStage:
          EntitlementCheckStage,

        dataSourceSelectionStage:
          DataSourceSelectionStage,

        collectionJobResolutionStage:
          CollectionJobResolutionStage,

        dataCollectionStage:
          DataCollectionStage,

        nlpAnalysisStage:
          NlpAnalysisStage,

        promptBuildingStage:
          PromptBuildingStage,

        coreIdeaGenerationStage:
          CoreIdeaGenerationStage,

        aiOutputValidationStage:
          AiOutputValidationStage,

        duplicateCheckStage:
          DuplicateCheckStage,

        ideaPersistenceStage:
          IdeaPersistenceStage,

        ...remainingStages: [
          ...IdeaGenerationStage[],
          FinalizationStage,
        ]
      ): readonly IdeaGenerationStage[] => {
        const finalizationStage =
          remainingStages[
            remainingStages.length - 1
          ];

        const premiumStages =
          remainingStages.slice(
            0,
            -1,
          );

        return [
          requestValidationStage,
          entitlementCheckStage,
          dataSourceSelectionStage,
          collectionJobResolutionStage,
          dataCollectionStage,
          nlpAnalysisStage,
          promptBuildingStage,
          coreIdeaGenerationStage,
          aiOutputValidationStage,
          duplicateCheckStage,
          ideaPersistenceStage,
          ...premiumStages,
          finalizationStage,
        ];
      },
    },

    /**
     * Existing idea-management services.
     */
    UserIdeasService,
    AdminIdeasService,
  ],

  exports: [
    IdeaGenerationOrchestratorService,
    IdeaGenerationRunService,
    IdeaGenerationCancellationService,
    UserIdeasService,
    AdminIdeasService,
  ],
})
export class IdeasModule {}