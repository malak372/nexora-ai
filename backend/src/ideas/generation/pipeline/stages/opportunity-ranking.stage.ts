import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_EVIDENCE_RECOVERY_ATTEMPTS,
  MIN_EVIDENCE_COVERAGE_BEFORE_RECOVERY,
  MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY,
  MIN_SELECTED_EVIDENCE_SCORE_BEFORE_RECOVERY,
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

    if (
      initialRanking &&
      this.hasEligibleOpportunity(initialRanking) &&
      !this.requiresEvidenceRecovery(initialRanking)
    ) {
      return this.buildSuccessResult(context, initialRanking, false, null);
    }

    if (context.evidenceRecoveryAttempts >= MAX_EVIDENCE_RECOVERY_ATTEMPTS) {
      if (initialRanking) {
        return this.buildFallbackResult(context, initialRanking, false, null);
      }

      this.throwInsufficientEvidence(initialRanking, context);
    }

    const recovery = await this.evidenceRecoveryService.recover(
      context,
      initialRanking?.selected ?? null,
    );

    const recoveredContext: IdeaGenerationContext = {
      ...context,
      /*
       * Keep the primary collection job as the canonical generation source.
       * The recovery job is supplemental evidence and is tracked separately in
       * evidenceRecoveryCollectionJobIds and stage metadata. Replacing the
       * canonical collection here caused the final snapshot to report only the
       * small recovery sample instead of the verified primary NLP totals.
       */
      collection: context.collection,
      nlp: this.mergeNlpContexts(context.nlp, recovery.nlp),
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

    if (!recoveredRanking) {
      if (initialRanking) {
        return this.buildFallbackResult(
          recoveredContext,
          initialRanking,
          true,
          {
            collectionJobId: recovery.collectionJobId,
            selectedDataSourceKeys: recovery.selectedDataSourceKeys,
            recoveryKeywords: recovery.recoveryKeywords,
            totalPosts: recovery.totalPosts,
            totalComments: recovery.totalComments,
          },
        );
      }

      this.throwInsufficientEvidence(recoveredRanking, recoveredContext);
    }

    if (!this.hasEligibleOpportunity(recoveredRanking)) {
      return this.buildFallbackResult(
        recoveredContext,
        recoveredRanking,
        true,
        {
          collectionJobId: recovery.collectionJobId,
          selectedDataSourceKeys: recovery.selectedDataSourceKeys,
          recoveryKeywords: recovery.recoveryKeywords,
          totalPosts: recovery.totalPosts,
          totalComments: recovery.totalComments,
        },
      );
    }

    return this.buildSuccessResult(recoveredContext, recoveredRanking, true, {
      collectionJobId: recovery.collectionJobId,
      selectedDataSourceKeys: recovery.selectedDataSourceKeys,
      recoveryKeywords: recovery.recoveryKeywords,
      totalPosts: recovery.totalPosts,
      totalComments: recovery.totalComments,
    });
  }

  /**
   * Merges supplemental recovery evidence with the original NLP context.
   *
   * Evidence recovery must add information rather than discard the primary
   * evidence. The primary analysis remains canonical for its identifier,
   * verified headline counts, statistics, and quality metrics. Recovery output
   * only supplements ranking-related evidence arrays with deduplicated entries.
   * Every merged sample is revalidated by IdeaOpportunityRankingService before
   * it affects scoring.
   */
  private mergeNlpContexts(
    primary: NonNullable<IdeaGenerationContext['nlp']>,
    recovered: NonNullable<IdeaGenerationContext['nlp']>,
  ): NonNullable<IdeaGenerationContext['nlp']> {
    return {
      ...primary,
      recurringProblems: this.mergeJsonEvidence(
        primary.recurringProblems,
        recovered.recurringProblems,
      ),
      extractedNeeds: this.mergeJsonEvidence(
        primary.extractedNeeds,
        recovered.extractedNeeds,
      ),
      featureRequests: this.mergeJsonEvidence(
        primary.featureRequests,
        recovered.featureRequests,
      ),
      opportunities: this.mergeJsonEvidence(
        primary.opportunities,
        recovered.opportunities,
      ),
      samplePosts: this.mergeJsonEvidence(
        primary.samplePosts,
        recovered.samplePosts,
      ),
      sampleComments: this.mergeJsonEvidence(
        primary.sampleComments,
        recovered.sampleComments,
      ),
      aiUsed: primary.aiUsed || recovered.aiUsed,
      confidence: this.mergeConfidence(
        primary.confidence,
        recovered.confidence,
      ),
    };
  }

  /** Deduplicates top-level JSON evidence without changing nested contracts. */
  private mergeJsonEvidence(
    primary: Prisma.JsonValue | null,
    recovered: Prisma.JsonValue | null,
  ): Prisma.JsonValue | null {
    if (!Array.isArray(primary) && !Array.isArray(recovered)) {
      return primary ?? recovered;
    }

    const values = [
      ...(Array.isArray(primary) ? primary : []),
      ...(Array.isArray(recovered) ? recovered : []),
    ];
    const seen = new Set<string>();

    return values.filter((value) => {
      const key = JSON.stringify(value);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private mergeConfidence(
    primary: number | null,
    recovered: number | null,
  ): number | null {
    if (primary === null) {
      return recovered;
    }

    if (recovered === null) {
      return primary;
    }

    return Math.round((primary * 0.7 + recovered * 0.3) * 1_000) / 1_000;
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
        context.communityAiAnalysis,
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

  /**
   * Requests one bounded recovery pass when the winner is technically eligible
   * but still lacks enough representative evidence for a defensible idea.
   */
  private requiresEvidenceRecovery(ranking: IdeaOpportunityRanking): boolean {
    const selected = ranking.selected;

    return (
      ranking.evidenceCoverage < MIN_EVIDENCE_COVERAGE_BEFORE_RECOVERY ||
      selected.evidenceScore < MIN_SELECTED_EVIDENCE_SCORE_BEFORE_RECOVERY ||
      selected.evidenceSamples.length <
        MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY
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

  /**
   * Continues with the strongest evidence-backed fallback after the bounded
   * recovery pass is exhausted. The ranking keeps its penalties and warnings,
   * allowing downstream prompts to present the result as preliminary rather
   * than persisting an unsupported high-confidence claim.
   */
  private buildFallbackResult(
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
    const fallbackWarning =
      'No opportunity passed the strict evidence gate after bounded recovery. The strongest available opportunity was selected with its reliability penalties preserved; generated claims must remain preliminary and pilot-validated.';

    const fallbackRanking: IdeaOpportunityRanking = {
      ...ranking,
      selectionReason: `${ranking.selectionReason} ${fallbackWarning}`,
      qualityWarnings: Array.from(
        new Set([...ranking.qualityWarnings, fallbackWarning]),
      ),
    };

    const result = this.buildSuccessResult(
      context,
      fallbackRanking,
      recoveryApplied,
      recoveryMetadata,
    );

    return {
      ...result,
      resultPreview: `Evidence recovery did not produce a strictly eligible opportunity; continuing with penalized fallback "${fallbackRanking.selected.title}" at ${(fallbackRanking.selected.finalScore * 100).toFixed(1)}/100.`,
      metadata: {
        ...(result.metadata ?? {}),
        fallbackApplied: true,
        qualityWarning: fallbackWarning,
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
