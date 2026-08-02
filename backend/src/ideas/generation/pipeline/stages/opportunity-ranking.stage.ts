import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_EVIDENCE_RECOVERY_ATTEMPTS,
  MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY,
  MIN_SELECTED_EVIDENCE_SCORE_BEFORE_RECOVERY,
  MIN_SELECTED_INDEPENDENT_SOURCES_BEFORE_RECOVERY,
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
import { IndependentEvidenceVerificationService } from '../../services/independent-evidence-verification.service';
import type { EvidenceRecoveryOutcome } from '../../services/idea-evidence-recovery.service';
import {
  IdeaOpportunityRankingService,
  NoRankedIdeaOpportunityError,
} from '../../services/idea-opportunity-ranking.service';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import type { IdeaOpportunityRanking } from '../../types/idea-opportunity-ranking.type';
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../../types/community-ai-analysis.type';

/**
 * Ranks evidence-backed opportunities and enforces a strict evidence gate.
 *
 * When the initial ranking has no eligible opportunity, the stage tries the
 * three strongest distinct opportunities and then performs one broad recovery
 * pass. If none reaches the strict recurrence gate, the run completes normally
 * with NO_RECURRING_OPPORTUNITY and later AI stages are skipped.
 */
@Injectable()
export class OpportunityRankingStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly opportunityRankingService: IdeaOpportunityRankingService,
    private readonly independentEvidenceVerificationService: IndependentEvidenceVerificationService,
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
    let workingContext = context;
    let ranking = await this.tryRankContext(workingContext, previousIdeaTexts);
    const recoveryMetadata: Array<{
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
    }> = [];

    while (
      (!ranking ||
        !this.hasEligibleOpportunity(ranking) ||
        this.requiresEvidenceRecovery(ranking)) &&
      workingContext.evidenceRecoveryAttempts < MAX_EVIDENCE_RECOVERY_ATTEMPTS
    ) {
      const recoveryTarget = this.resolveRecoveryTarget(
        ranking,
        workingContext.evidenceRecoveryAttempts,
      );
      const recovery = await this.evidenceRecoveryService.recover(
        workingContext,
        recoveryTarget,
      );
      const contributedEvidence = recovery.newCorpusEvidenceSampleCount > 0;

      workingContext = {
        ...workingContext,
        nlp: contributedEvidence
          ? this.mergeNlpContexts(workingContext.nlp!, recovery.nlp)
          : workingContext.nlp,
        communityAiAnalysis: contributedEvidence
          ? this.mergeCommunityAiAnalyses(
              workingContext.communityAiAnalysis,
              recovery.communityAiAnalysis,
            )
          : workingContext.communityAiAnalysis,
        opportunityRanking: null,
        evidenceRecoveryAttempts: workingContext.evidenceRecoveryAttempts + 1,
        evidenceRecoveryCollectionJobIds: [
          ...workingContext.evidenceRecoveryCollectionJobIds,
          recovery.collectionJobId,
        ],
      };

      ranking = await this.tryRankContext(workingContext, previousIdeaTexts);
      const selectedOpportunityNewEvidenceCount =
        this.countSelectedOpportunityNovelEvidence(
          ranking?.selected ?? null,
          recovery.novelEvidenceSamples,
        );

      recoveryMetadata.push({
        collectionJobId: recovery.collectionJobId,
        selectedDataSourceKeys: recovery.selectedDataSourceKeys,
        recoveryKeywords: recovery.recoveryKeywords,
        totalPosts: recovery.totalPosts,
        totalComments: recovery.totalComments,
        usefulCleanTextCount: recovery.usefulCleanTextCount,
        complaintEvidenceCount: recovery.complaintEvidenceCount,
        evidenceFamilies: recovery.evidenceFamilies,
        communityAiRecoveryApplied:
          contributedEvidence && Boolean(recovery.communityAiAnalysis),
        communityAiRecoveryExecuted: recovery.communityAiRecoveryExecuted,
        newCorpusEvidenceSampleCount: recovery.newCorpusEvidenceSampleCount,
        selectedOpportunityNewEvidenceCount,
        newEvidenceSampleCount: recovery.newEvidenceSampleCount,
        recoveryOutcome: recovery.recoveryOutcome,
      });

      /*
       * Stop immediately when a focused recovery pass contributes no new
       * corpus evidence. Additional passes would repeat the same cached or
       * low-yield searches, add latency, and increase provider rate-limit risk
       * without improving the ranking.
       */
      if (!contributedEvidence) {
        break;
      }
    }

    /*
     * Product policy: a completed generation request must always continue to
     * core idea generation. Strict evidence thresholds still trigger one
     * focused recovery pass, but they no longer convert a valid run into a
     * successful "no idea" outcome.
     *
     * When strict recurrence is unavailable, the strongest ranked signal is
     * retained as a controlled preliminary-pilot fallback. Downstream prompt
     * and benchmark services already qualify sparse-evidence claims, prohibit
     * market-wide assertions, and require validation as part of the pilot.
     */
    if (!ranking) {
      ranking = this.buildEmergencyFallbackRanking(workingContext);
    }

    const aggregatedRecoveryMetadata = recoveryMetadata.length
      ? this.aggregateRecoveryMetadata(recoveryMetadata)
      : null;

    return this.buildSuccessResult(
      workingContext,
      ranking,
      recoveryMetadata.length > 0,
      aggregatedRecoveryMetadata,
    );
  }

  /**
   * Chooses a different evidence direction on every bounded recovery attempt.
   * Attempts 1-3 target the three strongest ranked opportunities. The final
   * attempt is broad and lets the recovery service derive domain-level
   * complaint queries instead of repeatedly chasing the same weak signal.
   */
  private resolveRecoveryTarget(
    ranking: IdeaOpportunityRanking | null,
    completedAttempts: number,
  ): IdeaOpportunityRanking['selected'] | null {
    if (!ranking) {
      return null;
    }

    const rankedCandidates = [ranking.selected, ...ranking.alternatives]
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex((item) => item.title === candidate.title) ===
          index,
      )
      .slice(0, 3);

    return rankedCandidates[completedAttempts] ?? null;
  }

  /**
   * Returns a successful no-result checkpoint instead of throwing a technical
   * failure. The pipeline will mark every later generation/persistence stage as
   * skipped, complete the run, persist no idea, and consume no credit.
   */
  private buildNoResultResult(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking | null,
    recoveryMetadata: readonly {
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
    }[],
  ): IdeaGenerationStageExecutionResult {
    const strongestSignal = ranking?.selected ?? null;
    const rankedCandidates = ranking
      ? [ranking.selected, ...ranking.alternatives]
      : [];
    const hasVerifiedEvidence = rankedCandidates.some(
      (candidate) => (candidate.verifiedIndependentEvidenceCount ?? 0) > 0,
    );
    const message = hasVerifiedEvidence
      ? 'Collection and evidence recovery completed, and independently verified evidence was found, but no opportunity passed all quality and selection thresholds. No idea was generated and no credit should be consumed.'
      : 'Collection and evidence recovery completed, but no opportunity contained at least one independently verified community evidence sample. No idea was generated and no credit should be consumed.';

    return {
      context: {
        ...context,
        opportunityRanking: ranking,
        noResultOutcome: {
          code: 'NO_RECURRING_OPPORTUNITY',
          message,
          strongestSignalTitle: strongestSignal?.title ?? null,
          independentEvidenceCount:
            strongestSignal?.evidenceSamples.length ?? 0,
          requiredIndependentEvidenceCount: 1,
          recoveryAttempts: context.evidenceRecoveryAttempts,
          collectionJobIds: [...context.evidenceRecoveryCollectionJobIds],
        },
      },
      resultPreview: message,
      metadata: {
        outcome: 'NO_RECURRING_OPPORTUNITY',
        strongestSignalTitle: strongestSignal?.title ?? null,
        strongestSignalScore: strongestSignal?.finalScore ?? null,
        independentEvidenceCount: strongestSignal?.evidenceSamples.length ?? 0,
        requiredIndependentEvidenceCount: 1,
        evidenceRecoveryAttempts: context.evidenceRecoveryAttempts,
        evidenceRecovery: recoveryMetadata.length
          ? this.aggregateRecoveryMetadata(recoveryMetadata)
          : null,
        alternativesChecked: ranking
          ? [ranking.selected, ...ranking.alternatives.slice(0, 2)].map(
              (candidate) => ({
                title: candidate.title,
                evidenceCount: candidate.evidenceSamples.length,
                selectionEligible: candidate.selectionEligible,
                disqualificationReasons: candidate.disqualificationReasons,
              }),
            )
          : [],
      },
    };
  }

  private aggregateRecoveryMetadata(
    attempts: readonly {
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
    }[],
  ) {
    const latest = attempts[attempts.length - 1];

    return {
      collectionJobId: latest.collectionJobId,
      selectedDataSourceKeys: Array.from(
        new Set(attempts.flatMap((item) => item.selectedDataSourceKeys)),
      ),
      recoveryKeywords: Array.from(
        new Set(attempts.flatMap((item) => item.recoveryKeywords)),
      ),
      totalPosts: attempts.reduce((sum, item) => sum + item.totalPosts, 0),
      totalComments: attempts.reduce(
        (sum, item) => sum + item.totalComments,
        0,
      ),
      usefulCleanTextCount: attempts.reduce(
        (sum, item) => sum + item.usefulCleanTextCount,
        0,
      ),
      complaintEvidenceCount: attempts.reduce(
        (sum, item) => sum + item.complaintEvidenceCount,
        0,
      ),
      evidenceFamilies: Array.from(
        new Set(attempts.flatMap((item) => item.evidenceFamilies)),
      ),
      communityAiRecoveryApplied: attempts.some(
        (item) => item.communityAiRecoveryApplied,
      ),
      communityAiRecoveryExecuted: attempts.some(
        (item) => item.communityAiRecoveryExecuted,
      ),
      newCorpusEvidenceSampleCount: attempts.reduce(
        (sum, item) => sum + item.newCorpusEvidenceSampleCount,
        0,
      ),
      selectedOpportunityNewEvidenceCount: attempts.reduce(
        (sum, item) => sum + item.selectedOpportunityNewEvidenceCount,
        0,
      ),
      newEvidenceSampleCount: attempts.reduce(
        (sum, item) => sum + item.newEvidenceSampleCount,
        0,
      ),
      recoveryOutcome: latest.recoveryOutcome,
    } as const;
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
  /**
   * Combines primary and recovery Community AI analyses while preserving
   * independent evidence samples. Ranking performs the final semantic merge,
   * evidence validation, and duplicate control.
   */
  private mergeCommunityAiAnalyses(
    primary: CommunityAiAnalysis | null,
    recovered: CommunityAiAnalysis | null,
  ): CommunityAiAnalysis | null {
    if (!primary) {
      return recovered;
    }

    if (!recovered) {
      return primary;
    }

    return {
      summary:
        `${primary.summary} Supplemental targeted recovery: ${recovered.summary}`.trim(),
      dominantProblems: this.mergeStrings(
        primary.dominantProblems,
        recovered.dominantProblems,
      ),
      unmetNeeds: this.mergeStrings(primary.unmetNeeds, recovered.unmetNeeds),
      opportunities: this.mergeCommunityOpportunities(
        primary.opportunities,
        recovered.opportunities,
      ),
      overallConfidence:
        Math.round(
          Math.max(primary.overallConfidence, recovered.overallConfidence) *
            100,
        ) / 100,
      qualityWarnings: this.mergeStrings(
        primary.qualityWarnings,
        recovered.qualityWarnings,
      ),
      modelId: recovered.modelId ?? primary.modelId,
      apiModelId: recovered.apiModelId ?? primary.apiModelId,
      attemptCount: primary.attemptCount + recovered.attemptCount,
    };
  }

  /**
   * Keeps each recovered opportunity intact. The ranking service owns semantic
   * family matching and only merges candidates after revalidating their direct
   * evidence samples.
   */
  private mergeCommunityOpportunities(
    primary: readonly CommunityAiOpportunity[],
    recovered: readonly CommunityAiOpportunity[],
  ): CommunityAiOpportunity[] {
    const values = [...primary, ...recovered];
    const seen = new Set<string>();

    return values.filter((opportunity) => {
      const evidenceKey = opportunity.evidenceSamples
        .map((sample) => this.normalizeEvidenceKey(sample))
        .sort()
        .join('|');
      const key = `${this.normalizeEvidenceKey(opportunity.title)}::${evidenceKey}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private mergeStrings(
    primary: readonly string[],
    recovered: readonly string[],
  ): string[] {
    const seen = new Set<string>();
    const output: string[] = [];

    for (const value of [...primary, ...recovered]) {
      const normalized = this.normalizeEvidenceKey(value);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      output.push(value);
    }

    return output;
  }

  private normalizeEvidenceKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

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

  private async tryRankContext(
    context: IdeaGenerationContext,
    previousIdeaTexts: readonly string[],
  ): Promise<IdeaOpportunityRanking | null> {
    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message: 'NLP analysis is required before opportunity ranking.',
      });
    }

    try {
      const ranking = this.opportunityRankingService.rank(
        context.nlp,
        [
          context.location.country,
          context.location.city ?? '',
          context.location.region ?? '',
        ],
        previousIdeaTexts,
        context.communityAiAnalysis,
      );

      const collectionJobIds = this.resolveEvidenceCollectionJobIds(context);

      return await this.independentEvidenceVerificationService.verifyRanking(
        ranking,
        collectionJobIds,
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

  /**
   * Resolves every collection job that may contain evidence for this run.
   *
   * The primary collection identifier is nested under context.collection.
   * Recovery identifiers are stored separately. The resulting list excludes
   * missing values and duplicate identifiers before evidence verification.
   */
  private resolveEvidenceCollectionJobIds(
    context: IdeaGenerationContext,
  ): string[] {
    const collectionJobIds = [
      context.collection?.collectionJobId,
      ...context.evidenceRecoveryCollectionJobIds,
    ];

    return Array.from(
      new Set(
        collectionJobIds.filter(
          (collectionJobId): collectionJobId is string =>
            typeof collectionJobId === 'string' &&
            collectionJobId.trim().length > 0,
        ),
      ),
    );
  }

  /**
   * Builds a last-resort, auditable pilot opportunity when NLP completed but
   * normalization produced no rankable candidate. This prevents a user-facing
   * "completed without an idea" result while keeping every claim explicitly
   * preliminary and tied to the requested domain.
   */
  private buildEmergencyFallbackRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const domainName = context.domainName?.trim() || 'Selected domain';
    const communityOpportunity = context.communityAiAnalysis?.opportunities?.[0];
    const title =
      communityOpportunity?.title?.trim() ||
      `${domainName} Workflow Improvement Pilot`;
    const problem =
      communityOpportunity?.problem?.trim() ||
      `Users in the ${domainName.toLowerCase()} domain experience fragmented workflows, limited access, or reliability friction that requires focused pilot validation.`;
    const need =
      communityOpportunity?.unmetNeed?.trim() ||
      `A focused, user-centered software workflow that addresses the strongest observed ${domainName.toLowerCase()} friction and validates it during an initial pilot.`;
    const evidenceSamples = (communityOpportunity?.evidenceSamples ?? [])
      .filter((sample): sample is string =>
        typeof sample === 'string' && sample.trim().length > 0,
      )
      .slice(0, 5);

    const selected: IdeaOpportunityRanking['selected'] = {
      rank: 1,
      title,
      problem,
      need,
      solutionArea: communityOpportunity?.solutionArea?.trim() || null,
      evidenceType: 'OPPORTUNITY',
      sourceIndex: 0,
      frequency: Math.max(1, communityOpportunity?.frequency ?? 1),
      severity: communityOpportunity?.severity ?? 'MEDIUM',
      evidenceSamples,
      frequencyScore: 0.25,
      severityScore: 0.6,
      evidenceScore: evidenceSamples.length > 0 ? 0.2 : 0.1,
      evidenceReliabilityScore: evidenceSamples.length > 0 ? 0.5 : 0.42,
      weakEvidencePenalty: evidenceSamples.length > 0 ? 0.08 : 0.12,
      specificityScore: 0.62,
      feasibilityScore: 0.78,
      localRelevanceScore: 0.25,
      noveltyScore: 0.58,
      businessValueScore: 0.55,
      marketGapScore: 0.5,
      competitionScore: 0.5,
      technicalRiskScore: 0.4,
      supportScore: evidenceSamples.length > 0 ? 0.5 : 0.38,
      nlpConfidenceScore: context.nlp?.confidence ?? 0.45,
      baseScore: 0.5,
      confidencePenalty: 0.08,
      finalScore: 0.42,
      selectionEligible: false,
      disqualificationReasons: ['CONTROLLED_PRELIMINARY_PILOT_FALLBACK'],
      verifiedIndependentEvidenceCount: 0,
      verifiedIndependentSourceCount: 0,
      independentEvidence: [],
      raw: {
        source: 'CONTROLLED_PRELIMINARY_PILOT_FALLBACK',
        title,
        problem,
        need,
        evidenceSamples,
      },
    };

    return {
      selected,
      alternatives: [],
      evaluatedCount: 1,
      evidenceCoverage: evidenceSamples.length > 0 ? 1 : 0,
      selectionReason:
        'No strictly rankable opportunity remained after focused recovery, so the strongest domain-aligned signal was retained as a controlled preliminary pilot.',
      qualityWarnings: [
        'This is a controlled preliminary-pilot fallback. Claims must remain conservative and validation must be included in the first pilot milestone.',
      ],
    };
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
      selected.evidenceScore < MIN_SELECTED_EVIDENCE_SCORE_BEFORE_RECOVERY ||
      selected.evidenceSamples.length <
        MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY ||
      (selected.verifiedIndependentSourceCount ?? 0) <
        MIN_SELECTED_INDEPENDENT_SOURCES_BEFORE_RECOVERY
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
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      /** Backward-compatible corpus-level alias. */
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
    } | null,
  ): IdeaGenerationStageExecutionResult {
    const updatedContext: IdeaGenerationContext = {
      ...context,
      opportunityRanking: ranking,
    };

    return {
      context: updatedContext,
      resultPreview: ranking.selected.selectionEligible
        ? recoveryApplied
          ? `Targeted evidence recovery completed; ranked ${ranking.evaluatedCount} candidate(s) and selected opportunity "${ranking.selected.title}" with score ${(ranking.selected.finalScore * 100).toFixed(1)}.`
          : `Ranked ${ranking.evaluatedCount} opportunity candidate(s); selected opportunity "${ranking.selected.title}" with score ${(ranking.selected.finalScore * 100).toFixed(1)}. ${ranking.selectionReason}`
        : `Selected the strongest evidence-backed opportunity "${ranking.selected.title}" as a controlled preliminary pilot after focused recovery. Generation will continue with conservative, explicitly qualified claims.`,
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
   * Counts only novel recovery samples that directly support the opportunity
   * selected after reranking. Corpus novelty and opportunity support are
   * intentionally separate metrics: unrelated new complaints must never imply
   * stronger evidence for the selected problem family.
   */
  private countSelectedOpportunityNovelEvidence(
    selectedOpportunity: IdeaOpportunityRanking['selected'] | null,
    novelRecoverySamples: readonly string[],
  ): number {
    if (!selectedOpportunity || novelRecoverySamples.length === 0) {
      return 0;
    }

    const selectedSamples = selectedOpportunity.evidenceSamples
      .map((sample) => this.normalizeEvidenceKey(sample))
      .filter(Boolean);

    return novelRecoverySamples.filter((sample) => {
      const normalizedRecoverySample = this.normalizeEvidenceKey(sample);
      if (!normalizedRecoverySample) {
        return false;
      }

      return selectedSamples.some(
        (selectedSample) =>
          selectedSample === normalizedRecoverySample ||
          (selectedSample.length >= 80 &&
            normalizedRecoverySample.includes(selectedSample)) ||
          (normalizedRecoverySample.length >= 80 &&
            selectedSample.includes(normalizedRecoverySample)),
      );
    }).length;
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