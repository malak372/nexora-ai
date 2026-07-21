import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { CreditsModule } from '../../credits/credits.module';
import { DataCollectionModule } from '../../data-collection/data-collection.module';
import { NlpModule } from '../../nlp/nlp.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromptsModule } from '../../prompts/prompts.module';

import { GuestIdeaGenerationController } from './controllers/guest-idea-generation.controller';
import { IdeaGenerationRunsController } from './controllers/idea-generation-runs.controller';
import { UserIdeaGenerationController } from './controllers/user-idea-generation.controller';
import type { IdeaGenerationStage } from './interfaces/idea-generation-stage.interface';
import { IdeaGenerationCancellationService } from './pipeline/idea-generation-cancellation.service';
import { IdeaGenerationPipelineService } from './pipeline/idea-generation-pipeline.service';
import { IdeaGenerationProgressService } from './pipeline/idea-generation-progress.service';
import { IdeaGenerationStageService } from './pipeline/idea-generation-stage.service';
import { AiOutputValidationStage } from './pipeline/stages/ai-output-validation.stage';
import { CollectionJobResolutionStage } from './pipeline/stages/collection-job-resolution.stage';
import { CoreIdeaGenerationStage } from './pipeline/stages/core-idea-generation.stage';
import { DataCollectionStage } from './pipeline/stages/data-collection.stage';
import { DataSourceSelectionStage } from './pipeline/stages/data-source-selection.stage';
import { DuplicateCheckStage } from './pipeline/stages/duplicate-check.stage';
import { EntitlementCheckStage } from './pipeline/stages/entitlement-check.stage';
import { FinalizationStage } from './pipeline/stages/finalization.stage';
import { IdeaPersistenceStage } from './pipeline/stages/idea-persistence.stage';
import { NlpAnalysisStage } from './pipeline/stages/nlp-analysis.stage';
import { PromptBuildingStage } from './pipeline/stages/prompt-building.stage';
import { RequestValidationStage } from './pipeline/stages/request-validation.stage';
import {
  PREMIUM_OUTPUT_STAGE_PROVIDERS,
  PREMIUM_OUTPUT_STAGE_REGISTRATIONS,
} from './providers/premium-output-stage.providers';
import { CollectionJobResolverService } from './services/collection-job-resolver.service';
import { GuestIdeaSessionService } from './services/guest-idea-session.service';
import { IdeaAiOutputParserService } from './services/idea-ai-output-parser.service';
import { IdeaDuplicateDetectionService } from './services/idea-duplicate-detection.service';
import { IdeaGenerationLockService } from './services/idea-generation-lock.service';
import {
  IDEA_GENERATION_STAGES,
  IdeaGenerationOrchestratorService,
} from './services/idea-generation-orchestrator.service';
import { IdeaGenerationPolicyService } from './services/idea-generation-policy.service';
import { IdeaGenerationRunService } from './services/idea-generation-run.service';
import { IdeaGenerationSelectionService } from './services/idea-generation-selection.service';
import { IdeaPersistenceService } from './services/idea-persistence.service';
import { IdeaUnlockOutputParserService } from './services/idea-unlock-output-parser.service';

/**
 * Idea-generation bounded-context module.
 *
 * Owns generation endpoints, run monitoring, pipeline infrastructure,
 * executable stages, entitlement handling, AI output parsing, duplicate
 * detection, transactional persistence, and generation locking.
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
  ],
  providers: [
    IdeaGenerationRunService,
    IdeaGenerationProgressService,
    IdeaGenerationCancellationService,
    IdeaGenerationStageService,
    IdeaGenerationPipelineService,
    IdeaGenerationLockService,
    IdeaGenerationOrchestratorService,

    GuestIdeaSessionService,
    IdeaGenerationPolicyService,
    IdeaGenerationSelectionService,
    CollectionJobResolverService,
    IdeaAiOutputParserService,
    IdeaUnlockOutputParserService,
    IdeaDuplicateDetectionService,
    IdeaPersistenceService,

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

    ...PREMIUM_OUTPUT_STAGE_PROVIDERS,

    {
      provide: IDEA_GENERATION_STAGES,
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
        ...PREMIUM_OUTPUT_STAGE_REGISTRATIONS.map(({ token }) => token),
        FinalizationStage,
      ],
      useFactory: (
        requestValidationStage: RequestValidationStage,
        entitlementCheckStage: EntitlementCheckStage,
        dataSourceSelectionStage: DataSourceSelectionStage,
        collectionJobResolutionStage: CollectionJobResolutionStage,
        dataCollectionStage: DataCollectionStage,
        nlpAnalysisStage: NlpAnalysisStage,
        promptBuildingStage: PromptBuildingStage,
        coreIdeaGenerationStage: CoreIdeaGenerationStage,
        aiOutputValidationStage: AiOutputValidationStage,
        duplicateCheckStage: DuplicateCheckStage,
        ideaPersistenceStage: IdeaPersistenceStage,
        ...remainingStages: IdeaGenerationStage[]
      ): readonly IdeaGenerationStage[] => {
        const finalizationStage = remainingStages.at(-1);

        if (!finalizationStage) {
          throw new Error(
            'Finalization stage is missing from the idea-generation stage registry.',
          );
        }

        const premiumStages = remainingStages.slice(0, -1);

        if (
          premiumStages.length !== PREMIUM_OUTPUT_STAGE_REGISTRATIONS.length
        ) {
          throw new Error('Premium-output stage registry is incomplete.');
        }

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
  ],
  exports: [
    IdeaGenerationOrchestratorService,
    IdeaGenerationRunService,
    IdeaGenerationCancellationService,
    IdeaAiOutputParserService,
    IdeaUnlockOutputParserService,
    IdeaDuplicateDetectionService,
    IdeaPersistenceService,
  ],
})
export class IdeaGenerationModule {}
