import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AiModelsModule } from '../../ai-models/ai-models.module';
import { AiModule } from '../../ai/ai.module';
import { AlertsModule } from '../../alerts/alerts.module';
import { CreditsModule } from '../../credits/credits.module';
import { DataCollectionModule } from '../../data-collection/data-collection.module';
import { NlpModule } from '../../nlp/nlp.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromptsModule } from '../../prompts/prompts.module';

import { GuestIdeaGenerationController } from './controllers/guest-idea-generation.controller';
import { GuestIdeaGenerationRunsController } from './controllers/guest-idea-generation-runs.controller';
import { IdeaGenerationGateway } from './gateways/idea-generation.gateway';
import { IdeaGenerationRunsController } from './controllers/idea-generation-runs.controller';
import { UserIdeaGenerationController } from './controllers/user-idea-generation.controller';
import type { IdeaGenerationStage } from './interfaces/idea-generation-stage.interface';
import { IdeaGenerationCancellationService } from './pipeline/idea-generation-cancellation.service';
import { IdeaGenerationPipelineService } from './pipeline/idea-generation-pipeline.service';
import { IdeaGenerationProgressService } from './pipeline/idea-generation-progress.service';
import { IdeaGenerationStageService } from './pipeline/idea-generation-stage.service';
import { AiOutputValidationStage } from './pipeline/stages/ai-output-validation.stage';
import { CommunityAiAnalysisStage } from './pipeline/stages/community-ai-analysis.stage';
import { CollectionJobResolutionStage } from './pipeline/stages/collection-job-resolution.stage';
import { CoreIdeaGenerationStage } from './pipeline/stages/core-idea-generation.stage';
import { DataSourceSelectionStage } from './pipeline/stages/data-source-selection.stage';
import { DuplicateCheckStage } from './pipeline/stages/duplicate-check.stage';
import { EntitlementCheckStage } from './pipeline/stages/entitlement-check.stage';
import { FinalizationStage } from './pipeline/stages/finalization.stage';
import { IdeaPersistenceStage } from './pipeline/stages/idea-persistence.stage';
import { OpportunityRankingStage } from './pipeline/stages/opportunity-ranking.stage';
import { PromptBuildingStage } from './pipeline/stages/prompt-building.stage';
import { RequestValidationStage } from './pipeline/stages/request-validation.stage';
import { CommunityAiAnalysisPromptService } from './services/community-ai-analysis-prompt.service';
import { CommunityAiAnalysisService } from './services/community-ai-analysis.service';
import { CollectionJobResolverService } from './services/collection-job-resolver.service';
import { GuestIdeaSessionService } from './services/guest-idea-session.service';
import { DomainResolutionService } from './services/domain-resolution.service';
import { RequestCollectionPlanningService } from './services/request-collection-planning.service';
import { CollectionPreviewService } from './services/collection-preview.service';
import { IdeaAiOutputParserService } from './services/idea-ai-output-parser.service';
import { IdeaCandidateJudgePromptService } from './services/idea-candidate-judge-prompt.service';
import { IdeaCandidateJudgeService } from './services/idea-candidate-judge.service';
import { IdeaDuplicateDetectionService } from './services/idea-duplicate-detection.service';
import { IdeaEvidenceRecoveryService } from './services/idea-evidence-recovery.service';
import { IdeaGenerationBenchmarkService } from './services/idea-generation-benchmark.service';
import { IdeaGenerationDatabaseRetryService } from './services/idea-generation-database-retry.service';
import { IdeaGenerationRecoveryService } from './services/idea-generation-recovery.service';
import { IdeaGenerationModelSelectorService } from './services/idea-generation-model-selector.service';
import { IdeaGenerationLockService } from './services/idea-generation-lock.service';
import {
  IDEA_GENERATION_STAGES,
  IdeaGenerationOrchestratorService,
} from './services/idea-generation-orchestrator.service';
import { IdeaGenerationPolicyService } from './services/idea-generation-policy.service';
import { IdeaGenerationQueryService } from './services/idea-generation-query.service';
import { IdeaGenerationRunService } from './services/idea-generation-run.service';
import { IdeaGenerationRealtimeService } from './services/idea-generation-realtime.service';
import { IdeaGenerationSelectionService } from './services/idea-generation-selection.service';
import { IdeaPersistenceService } from './services/idea-persistence.service';
import { IdeaQualityEvaluatorService } from './services/idea-quality-evaluator.service';
import { IdeaOpportunityRankingService } from './services/idea-opportunity-ranking.service';
import { IndependentEvidenceVerificationService } from './services/independent-evidence-verification.service';
import { IdeaSemanticDiversityService } from './services/idea-semantic-diversity.service';
import { IdeaUnlockOutputParserService } from './services/idea-unlock-output-parser.service';

/**
 * Idea-generation bounded-context module.
 *
 * Owns generation endpoints, run monitoring, pipeline infrastructure,
 * executable stages, entitlement handling, AI output parsing, duplicate
 * detection, transactional persistence, and generation locking.
 *
 * Premium outputs are generated in the same structured core response. The
 * module intentionally avoids registering fourteen no-op premium checkpoint
 * stages so normal and premium runs share the same bounded fast path.
 *
 * @author malak
 */
@Module({
  imports: [
    JwtModule.register({}),
    PrismaModule,
    AiModelsModule,
    AiModule,
    AlertsModule,
    NlpModule,
    PromptsModule,
    DataCollectionModule,
    CreditsModule,
  ],
  controllers: [
    GuestIdeaGenerationController,
    GuestIdeaGenerationRunsController,
    UserIdeaGenerationController,
    IdeaGenerationRunsController,
  ],
  providers: [
    IdeaGenerationRunService,
    IdeaGenerationRealtimeService,
    IdeaGenerationGateway,
    IdeaGenerationQueryService,
    IdeaGenerationProgressService,
    IdeaGenerationCancellationService,
    IdeaGenerationStageService,
    IdeaGenerationDatabaseRetryService,
    IdeaGenerationPipelineService,
    IdeaGenerationRecoveryService,
    IdeaGenerationLockService,
    IdeaGenerationOrchestratorService,

    GuestIdeaSessionService,
    DomainResolutionService,
    RequestCollectionPlanningService,
    CollectionPreviewService,
    IdeaGenerationPolicyService,
    IdeaGenerationSelectionService,
    CollectionJobResolverService,
    IdeaAiOutputParserService,
    IdeaUnlockOutputParserService,
    IdeaDuplicateDetectionService,
    IdeaEvidenceRecoveryService,
    IdeaPersistenceService,
    IdeaQualityEvaluatorService,
    IdeaOpportunityRankingService,
    IndependentEvidenceVerificationService,
    IdeaSemanticDiversityService,
    IdeaCandidateJudgePromptService,
    IdeaCandidateJudgeService,
    IdeaGenerationBenchmarkService,
    IdeaGenerationModelSelectorService,
    CommunityAiAnalysisPromptService,
    CommunityAiAnalysisService,

    RequestValidationStage,
    EntitlementCheckStage,
    DataSourceSelectionStage,
    CollectionJobResolutionStage,
    CommunityAiAnalysisStage,
    OpportunityRankingStage,
    PromptBuildingStage,
    CoreIdeaGenerationStage,
    AiOutputValidationStage,
    DuplicateCheckStage,
    IdeaPersistenceStage,
    FinalizationStage,

    {
      provide: IDEA_GENERATION_STAGES,
      inject: [
        RequestValidationStage,
        EntitlementCheckStage,
        DataSourceSelectionStage,
        CollectionJobResolutionStage,
                CommunityAiAnalysisStage,
        OpportunityRankingStage,
        PromptBuildingStage,
        CoreIdeaGenerationStage,
        AiOutputValidationStage,
        DuplicateCheckStage,
        IdeaPersistenceStage,
        FinalizationStage,
      ],
      useFactory: (
        requestValidationStage: RequestValidationStage,
        entitlementCheckStage: EntitlementCheckStage,
        dataSourceSelectionStage: DataSourceSelectionStage,
        collectionJobResolutionStage: CollectionJobResolutionStage,
        communityAiAnalysisStage: CommunityAiAnalysisStage,
        opportunityRankingStage: OpportunityRankingStage,
        promptBuildingStage: PromptBuildingStage,
        coreIdeaGenerationStage: CoreIdeaGenerationStage,
        aiOutputValidationStage: AiOutputValidationStage,
        duplicateCheckStage: DuplicateCheckStage,
        ideaPersistenceStage: IdeaPersistenceStage,
        finalizationStage: FinalizationStage,
      ): readonly IdeaGenerationStage[] => [
        requestValidationStage,
        entitlementCheckStage,
        dataSourceSelectionStage,
        collectionJobResolutionStage,
        communityAiAnalysisStage,
        opportunityRankingStage,
        promptBuildingStage,
        coreIdeaGenerationStage,
        aiOutputValidationStage,
        duplicateCheckStage,
        ideaPersistenceStage,
        finalizationStage,
      ],
    },
  ],
  exports: [
    IdeaGenerationOrchestratorService,
    IdeaGenerationRunService,
    IdeaGenerationRealtimeService,
    IdeaGenerationGateway,
    IdeaGenerationQueryService,
    IdeaGenerationCancellationService,
    IdeaAiOutputParserService,
    IdeaUnlockOutputParserService,
    IdeaDuplicateDetectionService,
    IdeaPersistenceService,
    IdeaQualityEvaluatorService,
    IdeaOpportunityRankingService,
    IdeaSemanticDiversityService,
    IdeaCandidateJudgePromptService,
    IdeaCandidateJudgeService,
    IdeaGenerationBenchmarkService,
    IdeaGenerationModelSelectorService,
  ],
})
export class IdeaGenerationModule { }