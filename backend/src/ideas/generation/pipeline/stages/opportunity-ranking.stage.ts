import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/prisma.service';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_EVIDENCE_RECOVERY_ATTEMPTS,
} from '../../constants/idea-generation.constants';
import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { IdeaEvidenceRecoveryService } from '../../services/idea-evidence-recovery.service';
import {
  IdeaOpportunityRankingService,
  NoRankedIdeaOpportunityError,
} from '../../services/idea-opportunity-ranking.service';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import type { IdeaOpportunityRanking } from '../../types/idea-opportunity-ranking.type';

/**
 * Ranks evidence-backed opportunities and enforces a strict evidence gate.
 *
 * When the initial ranking has no eligible opportunity, the stage performs one
 * bounded targeted evidence-recovery collection pass. Idea-generation AI is
 * invoked only after an eligible opportunity exists.
 */
@Injectable()
export class OpportunityRankingStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly opportunityRankingService: IdeaOpportunityRankingService,
    private readonly evidenceRecoveryService: IdeaEvidenceRecoveryService,
    private readonly prisma: PrismaService,
  ) {}

  shouldExecute(): boolean {
    return true;
  }

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message: 'NLP analysis is required before opportunity ranking.',
      });
    }

    const previousIdeaTexts = await this.loadPreviousIdeaTexts(
      context.domainId,
    );
    const initialRanking = this.tryRankContext(context, previousIdeaTexts);

    if (initialRanking && this.hasEligibleOpportunity(initialRanking)) {
      return this.buildSuccessResult(context, initialRanking, false, null);
    }

    if (context.evidenceRecoveryAttempts >= MAX_EVIDENCE_RECOVERY_ATTEMPTS) {
      this.throwInsufficientEvidence(initialRanking, context);
    }

    const recovery = await this.evidenceRecoveryService.recover(context);

    const recoveredContext: IdeaGenerationContext = {
      ...context,
      collection: {
        collectionJobId: recovery.collectionJobId,
        reused: false,
        totalPosts: recovery.totalPosts,
        totalComments: recovery.totalComments,
      },
      nlp: recovery.nlp,
      opportunityRanking: null,
      evidenceRecoveryAttempts: context.evidenceRecoveryAttempts + 1,
      evidenceRecoveryCollectionJobIds: [
        ...context.evidenceRecoveryCollectionJobIds,
        recovery.collectionJobId,
      ],
    };

    const recoveredRanking = this.tryRankContext(
      recoveredContext,
      previousIdeaTexts,
    );

    if (!recoveredRanking || !this.hasEligibleOpportunity(recoveredRanking)) {
      this.throwInsufficientEvidence(recoveredRanking, recoveredContext);
    }

    return this.buildSuccessResult(recoveredContext, recoveredRanking, true, {
      collectionJobId: recovery.collectionJobId,
      selectedDataSourceKeys: recovery.selectedDataSourceKeys,
      recoveryKeywords: recovery.recoveryKeywords,
      totalPosts: recovery.totalPosts,
      totalComments: recovery.totalComments,
    });
  }

  private async loadPreviousIdeaTexts(domainId: string): Promise<string[]> {
    try {
      const previousIdeas = await this.prisma.idea.findMany({
        where: {
          domainId,
          deletedAt: null,
        },
        select: {
          title: true,
          problemStatement: true,
          objectives: true,
          targetUsers: true,
          partialAbstract: true,
          fullAbstract: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 150,
      });

      return previousIdeas
        .map((idea) =>
          [
            idea.title,
            idea.problemStatement,
            JSON.stringify(idea.objectives),
            JSON.stringify(idea.targetUsers),
            idea.partialAbstract ?? '',
            idea.fullAbstract ?? '',
          ].join(' '),
        )
        .map((text) => text.replace(/\s+/gu, ' ').trim())
        .filter(Boolean);
    } catch (error: unknown) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load previous ideas for opportunity ranking.',
      });
    }
  }

  private tryRankContext(
    context: IdeaGenerationContext,
    previousIdeaTexts: readonly string[],
  ): IdeaOpportunityRanking | null {
    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message: 'NLP analysis is required before opportunity ranking.',
      });
    }

    try {
      return this.opportunityRankingService.rank(
        context.nlp,
        [
          context.location.country,
          context.location.city ?? '',
          context.location.region ?? '',
        ],
        previousIdeaTexts,
      );
    } catch (error: unknown) {
      if (error instanceof NoRankedIdeaOpportunityError) {
        return null;
      }

      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to rank the discovered product opportunities.',
      });
    }
  }

  private hasEligibleOpportunity(ranking: IdeaOpportunityRanking): boolean {
    return [ranking.selected, ...ranking.alternatives].some(
      (opportunity) => opportunity.selectionEligible,
    );
  }

  private buildSuccessResult(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
    recoveryApplied: boolean,
    recoveryMetadata: {
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
    } | null,
  ): IdeaGenerationStageExecutionResult {
    const updatedContext: IdeaGenerationContext = {
      ...context,
      opportunityRanking: ranking,
    };

    return {
      context: updatedContext,
      resultPreview: recoveryApplied
        ? `Targeted evidence recovery succeeded; ranked ${ranking.evaluatedCount} candidate(s) and selected eligible opportunity "${ranking.selected.title}" with score ${(ranking.selected.finalScore * 100).toFixed(1)}.`
        : `Ranked ${ranking.evaluatedCount} opportunity candidate(s); selected eligible opportunity "${ranking.selected.title}" with score ${(ranking.selected.finalScore * 100).toFixed(1)}. ${ranking.selectionReason}`,
      metadata: {
        selectedTitle: ranking.selected.title,
        selectedScore: ranking.selected.finalScore,
        selectedEligible: ranking.selected.selectionEligible,
        evidenceRecoveryApplied: recoveryApplied,
        evidenceRecoveryAttempts: updatedContext.evidenceRecoveryAttempts,
        evidenceRecovery: recoveryMetadata,
        shortlistedOpportunities: [
          ranking.selected,
          ...ranking.alternatives.slice(0, 4),
        ].map((opportunity) => ({
          rank: opportunity.rank,
          title: opportunity.title,
          score: opportunity.finalScore,
          baseScore: opportunity.baseScore,
          supportScore: opportunity.supportScore,
          evidenceReliabilityScore: opportunity.evidenceReliabilityScore,
          nlpConfidenceScore: opportunity.nlpConfidenceScore,
          confidencePenalty: opportunity.confidencePenalty,
          selectionEligible: opportunity.selectionEligible,
          disqualificationReasons: opportunity.disqualificationReasons,
        })),
        selectionReason: ranking.selectionReason,
        evidenceCoverage: ranking.evidenceCoverage,
        evaluatedCount: ranking.evaluatedCount,
        qualityWarnings: [...ranking.qualityWarnings],
      },
    };
  }

  private throwInsufficientEvidence(
    ranking: IdeaOpportunityRanking | null,
    context: IdeaGenerationContext,
  ): never {
    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.INSUFFICIENT_EVIDENCE_FOR_IDEA_GENERATION,
      message:
        'No sufficiently reliable community opportunity was found after targeted evidence recovery. Idea generation was stopped before contacting the generation AI, and no idea should be persisted from this run.',
      details: {
        evidenceRecoveryAttempts: context.evidenceRecoveryAttempts,
        collectionJobIds: context.evidenceRecoveryCollectionJobIds,
        selectedFallbackTitle: ranking?.selected.title ?? null,
        selectedFallbackScore: ranking?.selected.finalScore ?? null,
        disqualificationReasons: ranking?.selected.disqualificationReasons ?? [
          'NO_RANKABLE_EVIDENCE_BACKED_OPPORTUNITY',
        ],
        qualityWarnings: ranking?.qualityWarnings ?? [
          'NLP completed, but every extracted candidate was removed by the evidence-quality gate.',
        ],
      },
    });
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}
