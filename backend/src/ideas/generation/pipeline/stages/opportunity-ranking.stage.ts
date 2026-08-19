import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import { classifyDirectCommunityEvidence } from '../../../../nlp/common/utils/community-evidence.util';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_EVIDENCE_RECOVERY_ATTEMPTS,
  MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY,
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
  IndependentEvidenceVerificationService,
  type EvidenceProvenanceHint,
} from '../../services/independent-evidence-verification.service';
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
 * Ranks evidence-backed opportunities and applies bounded evidence recovery.
 *
 * The stage never terminates generation solely because the strict evidence gate
 * remains unmet. After bounded recovery it continues with the strongest ranked
 * signal, or with a primary-domain validation hypothesis when no rankable signal
 * exists. Downstream prompt, benchmark, and validation stages are responsible for
 * keeping sparse-evidence claims explicitly qualified.
 */
@Injectable()
export class OpportunityRankingStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  private readonly previousIdeaTextCache = new Map<
    string,
    { readonly expiresAt: number; readonly texts: readonly string[] }
  >();

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
    let ranking = this.enforcePrimaryDomainFallback(
      await this.tryRankContext(workingContext, previousIdeaTexts),
      workingContext,
    );
    if (ranking) {
      // Apply request intent before recovery so a mismatch cannot consume the
      // bounded recovery budget just because its existing evidence is strong.
      ranking = this.applyRequestIntentAlignment(ranking, workingContext);
    }
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
      this.shouldRunEvidenceRecovery(ranking, workingContext) &&
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

      ranking = this.enforcePrimaryDomainFallback(
        await this.tryRankContext(workingContext, previousIdeaTexts),
        workingContext,
      );
      if (ranking) {
        ranking = this.applyRequestIntentAlignment(ranking, workingContext);
      }
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
     * A generated idea must have at least one independently verified direct
     * community evidence sample. A primary-domain validation hypothesis is
     * useful internally for recovery targeting, but it is not sufficient to
     * justify charging the user or persisting a premium idea.
     *
     * One verified report is enough for a cautious preliminary pilot. The
     * existing recurrence gate remains stricter and still requires independent
     * multi-source support before recurring-demand language is allowed.
     */
    const rankedCandidates = ranking
      ? [ranking.selected, ...ranking.alternatives]
      : [];
    const hasVerifiedDirectEvidence = rankedCandidates.some(
      (candidate) =>
        (candidate.verifiedProblemMatchedDirectUserEvidenceCount ??
          candidate.verifiedIndependentEvidenceCount ??
          0) > 0,
    );
    const hasRetainedDirectEvidence = rankedCandidates.some((candidate) =>
      candidate.evidenceSamples.some((sample) =>
        this.looksLikeDirectProblemEvidence(sample),
      ),
    );

    /*
     * Independent recurrence is a confidence/reporting gate, not a generation
     * gate. One retained, concrete, in-domain community complaint is enough for
     * a cautious preliminary pilot. Never overwrite that real evidence with a
     * synthetic PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS merely because it has not
     * yet been observed across several independent sources.
     */
    if (!hasVerifiedDirectEvidence && !hasRetainedDirectEvidence) {
      ranking = this.buildEmergencyFallbackRanking(workingContext);
    }

    ranking = ranking ?? this.buildEmergencyFallbackRanking(workingContext);

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
   * Runs recovery only when the primary corpus has no usable direct signal.
   *
   * A concrete feature request, bug report, failure description, or explicit
   * missing-capability statement is already valuable evidence for a bounded
   * pilot, even when strict recurrence verification has not reached the
   * multi-source gate. Skipping recovery in that case avoids repeating a full
   * collection/NLP/Community-AI pass that cannot materially improve the idea.
   */
  private shouldRunEvidenceRecovery(
    ranking: IdeaOpportunityRanking | null,
    context: IdeaGenerationContext,
  ): boolean {
    /*
     * A zero-text primary corpus means the selected collectors did not produce
     * any usable evidence. Running a full second collection + NLP + Community
     * AI pass in that case is expensive and, in practice, usually repeats the
     * same empty outcome. Continue immediately with a clearly qualified
     * preliminary fallback instead of spending 40-60 extra seconds.
     */
    const primaryTextCount = Math.max(
      context.nlp?.totalTextsAnalyzed ?? 0,
      (context.nlp?.totalPostsAnalyzed ?? 0) +
        (context.nlp?.totalCommentsAnalyzed ?? 0),
    );

    const representativeEvidenceCount = context.domainEvidence.reduce(
      (total, domain) =>
        total +
        this.readDomainEvidenceTexts(domain.samplePosts).length +
        this.readDomainEvidenceTexts(domain.sampleComments).length,
      0,
    );

    /*
     * A corpus of one or two analyzed texts with no representative complaint
     * is too weak to justify another collection + NLP + Community-AI cycle.
     * In observed runs that recovery added roughly 50 seconds and still
     * returned no direct evidence. Continue with a primary-domain hypothesis
     * instead of repeating the same low-yield path.
     */
    if (primaryTextCount <= 0 && representativeEvidenceCount === 0) {
      // One targeted recovery pass is justified when the primary collection
      // produced no usable text at all. The recovery service uses problem-family
      // queries rather than repeating the broad domain search.
      return context.evidenceRecoveryAttempts === 0;
    }

    if (primaryTextCount <= 2 && representativeEvidenceCount === 0) {
      return context.evidenceRecoveryAttempts === 0;
    }

    if (!ranking) {
      return true;
    }

    /*
     * One traceable in-domain complaint/request is enough to continue with a
     * cautious preliminary pilot. Recurrence remains a reporting qualifier,
     * while provenance verification still decides whether the sample is
     * eligible evidence.
     */
    const selectedIsInDomain =
      !ranking.selected.disqualificationReasons.includes('OFF_SELECTED_DOMAIN');
    const selectedHasVerifiedEvidence =
      (ranking.selected.verifiedProblemMatchedEvidenceCount ??
        ranking.selected.verifiedIndependentEvidenceCount ??
        0) > 0;
    const selectedHasDirectEvidence = ranking.selected.evidenceSamples.some(
      (sample) => this.looksLikeDirectProblemEvidence(sample),
    );

    /*
     * One direct in-domain report is explicitly sufficient for a cautious
     * pilot. Do not spend another collection + NLP + Community-AI cycle merely
     * to satisfy recurrence; recurrence remains a reporting qualifier, not a
     * generation gate. This removes the ~20-30s recovery penalty seen in
     * healthy single-evidence runs.
     */
    if (
      selectedIsInDomain &&
      (selectedHasVerifiedEvidence || selectedHasDirectEvidence)
    ) {
      return false;
    }

    /*
     * When intent gating replaced an unrelated high-evidence winner with a
     * request-validation hypothesis, unrelated direct evidence elsewhere in
     * the corpus must not suppress the one bounded targeted recovery pass.
     */
    if (
      context.requestDescription?.trim() &&
      ranking.selected.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      ) &&
      context.evidenceRecoveryAttempts === 0
    ) {
      return true;
    }

    /*
     * domainEvidence is produced from the original collector corpus before
     * recovery. If it already contains one direct in-domain report, recovery
     * would only rediscover evidence we possess. Skip it even if a conservative
     * ranking fallback has not yet promoted that report.
     */
    if (this.hasDirectEvidenceInContext(context)) {
      return false;
    }

    const selectedHasEnoughEvidence =
      ranking.selected.selectionEligible &&
      !this.requiresEvidenceRecovery(ranking);

    if (selectedHasEnoughEvidence) {
      return false;
    }

    const hasAnyDirectSignal =
      this.hasDirectEvidenceInContext(context) ||
      this.hasDirectUsableEvidence(ranking);

    /*
     * If direct evidence exists but the selected winner is off-domain, allow
     * one targeted recovery pass to find an in-domain replacement. Otherwise
     * direct in-domain evidence has already returned above.
     */
    if (hasAnyDirectSignal) {
      /*
       * Direct evidence that survived ranking is already more valuable than a
       * second broad collection for a preliminary pilot. Recovery is reserved
       * for genuinely evidence-free runs.
       */
      return false;
    }

    return (
      !this.hasEligibleOpportunity(ranking) ||
      this.requiresEvidenceRecovery(ranking)
    );
  }

  /**
   * Detects direct community evidence independently from the strict recurrence
   * counters. The recurrence counters remain unchanged for honest reporting.
   */
  private hasDirectUsableEvidence(ranking: IdeaOpportunityRanking): boolean {
    return [ranking.selected, ...ranking.alternatives].some((candidate) => {
      if (
        (candidate.verifiedProblemMatchedEvidenceCount ??
          candidate.verifiedIndependentEvidenceCount ??
          0) > 0
      ) {
        return true;
      }

      return this.readCandidateEvidenceSamples(candidate.raw).some((sample) =>
        this.looksLikeDirectProblemEvidence(sample),
      );
    });
  }

  /** Reads raw evidenceSamples from Prisma JSON without unsafe property access. */
  private readCandidateEvidenceSamples(value: Prisma.JsonValue): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    const samples = (value as Prisma.JsonObject).evidenceSamples;

    if (!Array.isArray(samples)) {
      return [];
    }

    return samples
      .filter((sample): sample is string => typeof sample === 'string')
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
  }

  /**
   * Accepts explicit user/developer problem reports, not product marketing.
   * This is deliberately stricter than generic keyword relevance.
   */
  private looksLikeDirectProblemEvidence(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const commentMatch = normalized.match(/\bCommunity comment:\s*(.+)$/iu);
    const evidenceText = commentMatch?.[1]?.trim() ?? normalized;

    const kind = classifyDirectCommunityEvidence(
      evidenceText,
      commentMatch ? 'COMMENT' : 'POST',
    );
    return kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST';
  }

  /**
   * Checks representative evidence already attached to selected domains.
   * A valid complaint/request is enough for a bounded preliminary pilot and
   * must not trigger another collection + NLP + Community-AI cycle.
   */
  private hasDirectEvidenceInContext(context: IdeaGenerationContext): boolean {
    return context.domainEvidence.some((domain) => {
      const samples = [
        ...this.readDomainEvidenceTexts(domain.samplePosts),
        ...this.readDomainEvidenceTexts(domain.sampleComments),
      ];

      return samples.some((sample) =>
        this.looksLikeDirectProblemEvidence(sample),
      );
    });
  }

  /**
   * Reads representative domain-evidence text from nullable Prisma JSON.
   *
   * Domain evidence is persisted as JsonValue, so samplePosts/sampleComments
   * cannot be accessed as typed arrays directly. Invalid entries are ignored
   * instead of failing the whole generation run.
   */
  private readDomainEvidenceTexts(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const rawText = (item as Prisma.JsonObject).text;

        return typeof rawText === 'string'
          ? rawText.replace(/\s+/gu, ' ').trim()
          : null;
      })
      .filter((item): item is string => Boolean(item));
  }

  /**
   * Prevents an unsupported secondary-domain fallback from becoming the final
   * product direction. Secondary domains may win only when they retain direct
   * evidence. With no direct evidence, generation remains anchored to the
   * primary domain selected by the user.
   */
  private enforcePrimaryDomainFallback(
    ranking: IdeaOpportunityRanking | null,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking | null {
    if (!ranking) {
      return this.buildPrimaryDomainHypothesisRanking(context);
    }

    const candidates = [ranking.selected, ...ranking.alternatives];
    const directCandidate = candidates.find((candidate) => {
      if (candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN')) {
        return false;
      }

      const hasVerifiedRetainedEvidence =
        candidate.independentEvidence?.some(
          (evidence) =>
            evidence.evidenceKind !== 'UNKNOWN' &&
            evidence.evidenceKind !== 'SPECIFICATION',
        ) ?? false;
      const hasDirectProblemSample = candidate.evidenceSamples.some((sample) =>
        this.looksLikeDirectProblemEvidence(sample),
      );

      return hasVerifiedRetainedEvidence || hasDirectProblemSample;
    });

    if (directCandidate) {
      const directEvidenceCount = directCandidate.evidenceSamples.filter(
        (sample) => this.looksLikeDirectProblemEvidence(sample),
      ).length;
      const verifiedDirectEvidenceCount =
        directCandidate.verifiedProblemMatchedDirectUserEvidenceCount ??
        directCandidate.verifiedDirectUserEvidenceCount ??
        directCandidate.verifiedIndependentEvidenceCount ??
        0;
      const verifiedSecondaryEvidenceCount =
        directCandidate.verifiedProblemMatchedSecondaryEvidenceCount ??
        directCandidate.verifiedSecondaryEvidenceCount ??
        0;
      const verifiedTechnicalEvidenceCount =
        directCandidate.verifiedProblemMatchedTechnicalEvidenceCount ??
        directCandidate.verifiedTechnicalEvidenceCount ??
        0;
      const verifiedFeatureRequestEvidenceCount =
        directCandidate.verifiedProblemMatchedFeatureRequestEvidenceCount ??
        directCandidate.verifiedFeatureRequestEvidenceCount ??
        0;
      const verifiedComplaintEvidenceCount =
        directCandidate.verifiedProblemMatchedComplaintEvidenceCount ??
        directCandidate.verifiedComplaintEvidenceCount ??
        0;
      const featureRequestOnly =
        verifiedDirectEvidenceCount > 0 &&
        verifiedComplaintEvidenceCount === 0 &&
        verifiedFeatureRequestEvidenceCount === verifiedDirectEvidenceCount;
      const verifiedEvidenceCount =
        directCandidate.verifiedProblemMatchedEvidenceCount ??
        directCandidate.verifiedEvidenceCount ??
        Math.max(
          directEvidenceCount,
          verifiedDirectEvidenceCount +
            verifiedSecondaryEvidenceCount +
            verifiedTechnicalEvidenceCount,
        );
      const verifiedDirectSourceCount =
        directCandidate.verifiedProblemMatchedSourceCount ??
        directCandidate.verifiedIndependentSourceCount ??
        0;
      const verifiedSourceCount =
        directCandidate.verifiedProblemMatchedEvidenceSourceCount ??
        directCandidate.verifiedEvidenceSourceCount ??
        verifiedDirectSourceCount;

      const selectionReason = directCandidate.selectionEligible
        ? featureRequestOnly
          ? `Selected the strongest evidence-backed preliminary opportunity after retaining ${verifiedFeatureRequestEvidenceCount} verified feature request(s) across ${Math.max(1, verifiedDirectSourceCount)} source(s). Feature requests are direct demand signals but do not by themselves establish complaint recurrence.`
          : verifiedDirectEvidenceCount > 0
            ? `Selected the strongest evidence-backed preliminary opportunity after retaining ${verifiedDirectEvidenceCount} verified direct user report(s) across ${Math.max(1, verifiedDirectSourceCount)} direct source(s). Recurrence is not established unless at least 3 direct reports span 2 independent sources.`
            : verifiedSecondaryEvidenceCount > 0
            ? `Selected the strongest evidence-backed preliminary opportunity from ${verifiedSecondaryEvidenceCount} retained secondary report(s) across ${Math.max(1, verifiedSourceCount)} retained source(s); no verified direct user complaint establishes recurrence.`
            : verifiedTechnicalEvidenceCount > 0
              ? `Selected the strongest evidence-backed preliminary opportunity from ${verifiedTechnicalEvidenceCount} retained technical ticket(s) across ${Math.max(1, verifiedSourceCount)} retained source(s); no verified direct user complaint establishes recurrence.`
              : `Selected the strongest available domain-aligned preliminary opportunity from retained evidence; no verified direct user complaint establishes recurrence.`
        : `${verifiedEvidenceCount === 1 ? 'One problem-matched evidence item was retained' : `${verifiedEvidenceCount} problem-matched evidence items were retained`}, but the evidence does not yet satisfy the independent recurrence requirement of at least 3 verified direct reports across 2 independent sources.`;

      const ordered = [
        directCandidate,
        ...candidates.filter((candidate) => candidate !== directCandidate),
      ].map((candidate, index) => ({ ...candidate, rank: index + 1 }));

      return {
        ...ranking,
        selected: ordered[0],
        alternatives: ordered.slice(1),
        selectionReason,
      };
    }

    /*
     * No selected-domain candidate retained independently verifiable evidence.
     * Do not force a weak or synthetic candidate from the first selected domain.
     * The validation fallback preserves the complete selected-domain scope and,
     * when a request description exists, preserves that exact requester intent.
     */
    return this.buildPrimaryDomainHypothesisRanking(context);
  }

  private readCandidateDomainName(value: Prisma.JsonValue): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }

    const domainName = (value as Prisma.JsonObject).domainName;
    return typeof domainName === 'string' ? domainName.trim() : '';
  }

  private isMissingEvidencePlaceholder(value: string): boolean {
    return /(?:problem .* not captured|no direct community evidence|highest-value .* problem before full implementation|validation-first workflow opportunity)/iu.test(
      value,
    );
  }

  /**
   * Creates a primary-domain validation hypothesis without pretending that an
   * absent community problem is itself evidence.
   */
  private buildPrimaryDomainHypothesisRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const selectedDomainNames = [
      ...new Set(
        context.selectedDomains
          .map((domain) => domain.name?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    if (selectedDomainNames.length === 0) {
      const fallbackDomainName = context.domainName?.trim();
      if (fallbackDomainName) {
        selectedDomainNames.push(fallbackDomainName);
      }
    }
    if (selectedDomainNames.length === 0) {
      selectedDomainNames.push('Selected domain');
    }

    const domainLabel = selectedDomainNames.join(' + ');
    const requestDescription = context.requestDescription?.trim() ?? '';
    const isCrossDomain = selectedDomainNames.length > 1;
    const title = requestDescription
      ? 'Requester-Defined Workflow Opportunity'
      : isCrossDomain
        ? 'Connected Workflow Opportunity Discovery'
        : `${domainLabel} Opportunity Discovery`;
    const problem = requestDescription
      ? `The requester wants to address this specific problem across the resolved generation scope (${domainLabel}): "${requestDescription}". Direct community evidence was not sufficiently aligned inside the bounded fast-search budget, so the generated direction must validate this exact requester workflow instead of substituting a different well-evidenced problem.`
      : isCrossDomain
        ? `The pilot will test which concrete connected workflow across ${domainLabel} has enough real user evidence to justify implementation. The selected domains are treated as an explicit search space, and the pilot may validate one domain-specific problem or a genuinely connected cross-domain problem without privileging the first domain merely because it owns persistence.`
        : `The pilot will test whether teams working in ${domainLabel} need a structured, low-cost workflow for collecting, classifying, and validating operational-friction reports before committing to a full software implementation.`;
    const need = requestDescription
      ? `A bounded validation workflow that preserves the requester-described problem, tests it with real target users across the relevant selected domains, captures direct evidence, and measures whether a focused implementation is justified.`
      : isCrossDomain
        ? `A bounded evidence-discovery pilot that compares real problem signals across the selected domains and validates a coherent single-domain or cross-domain implementation direction.`
        : `A bounded pilot that captures real user reports, groups recurring workflow problems, and measures which problem family is strong enough to justify implementation.`;
    const solutionArea = requestDescription
      ? 'Requester-intent validation, cross-domain evidence capture, and bounded pilot workflow'
      : isCrossDomain
        ? 'Cross-domain evidence intake, problem-family comparison, and pilot validation workflow'
        : 'User-feedback intake, evidence classification, and pilot validation workflow';
    const domainRelevanceScores = Object.fromEntries(
      selectedDomainNames.map((name) => [name, 1]),
    );

    const supportingEvidence = requestDescription
      ? [
          {
            sourceType: 'REQUESTER_STATEMENT' as const,
            text: requestDescription,
            qualifiesAsCommunityEvidence: false,
          },
        ]
      : [
          {
            sourceType:
              context.domainResolution?.source === 'USER_SELECTED'
                ? ('REQUESTER_DOMAIN_SELECTION' as const)
                : ('PERSONALIZATION_SIGNAL' as const),
            text: `Validation scope: ${selectedDomainNames.join(' + ')}`,
            qualifiesAsCommunityEvidence: false,
          },
        ];

    const selected: IdeaOpportunityRanking['selected'] = {
      rank: 1,
      title,
      problem,
      need,
      solutionArea,
      evidenceType: 'OPPORTUNITY',
      sourceIndex: 0,
      frequency: 0,
      severity: 'MEDIUM',
      evidenceSamples: [],
      frequencyScore: 0,
      severityScore: 0.6,
      evidenceScore: 0,
      evidenceReliabilityScore: 0.1,
      weakEvidencePenalty: 0.26,
      specificityScore: requestDescription ? 0.9 : 0.72,
      feasibilityScore: 0.88,
      localRelevanceScore: 0.25,
      noveltyScore: 0.62,
      businessValueScore: 0.5,
      marketGapScore: 0.5,
      competitionScore: 0.5,
      technicalRiskScore: 0.32,
      supportScore: 0.08,
      nlpConfidenceScore: context.nlp?.confidence ?? 0.2,
      baseScore: 0.24,
      confidencePenalty: 0.16,
      finalScore: requestDescription ? 0.18 : 0.08,
      matchedDomainNames: selectedDomainNames,
      domainRelevanceScores,
      selectionEligible: false,
      disqualificationReasons: [
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        'NO_DIRECT_EVIDENCE',
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      ],
      verifiedIndependentEvidenceCount: 0,
      verifiedIndependentSourceCount: 0,
      independentEvidence: [],
      requestIntentAlignmentScore: requestDescription ? 1 : undefined,
      requestIntentAdjustedScore: requestDescription ? 0.18 : undefined,
      supportingEvidence,
      raw: {
        source: 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        domainName: selectedDomainNames[0],
        domainNames: selectedDomainNames,
        title,
        problem,
        unmetNeed: need,
        solutionArea,
        requestDescription: requestDescription || null,
        requestIntentAlignmentScore: requestDescription ? 1 : null,
        evidenceSamples: [],
        supportingEvidence,
      },
    };

    return {
      selected,
      alternatives: [],
      evaluatedCount: 1,
      evidenceCoverage: 0,
      selectionReason: requestDescription
        ? `No sufficiently request-aligned direct community problem was retained within the fast collection budget. The run stays anchored to the explicit requester problem across ${domainLabel} and uses a validation pilot rather than switching to an unrelated high-evidence problem.`
        : isCrossDomain
          ? `No direct community problem was retained within the fast collection budget. The run keeps all explicitly selected domains (${domainLabel}) in the validation search space instead of forcing the first domain to win by position.`
          : `No direct community problem was retained within the fast collection budget. The run remains anchored to "${domainLabel}" and generates a clearly labeled validation hypothesis.`,
      qualityWarnings: [
        requestDescription
          ? 'No sufficiently request-aligned direct community problem was established. The requester statement is preserved as traceable scope evidence but does not count as community demand evidence.'
          : 'No direct community problem was established. The selected-domain or personalization signal is preserved only as traceable validation-scope support and does not count as market-demand evidence.',
        'The selected location is a pilot deployment target and is not claimed as evidence origin.',
      ],
    };
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
      (candidate) =>
        (candidate.verifiedProblemMatchedDirectUserEvidenceCount ??
          candidate.verifiedIndependentEvidenceCount ??
          0) > 0,
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
            strongestSignal?.verifiedProblemMatchedEvidenceCount ??
            strongestSignal?.verifiedIndependentEvidenceCount ??
            0,
          requiredIndependentEvidenceCount:
            MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY,
          recoveryAttempts: context.evidenceRecoveryAttempts,
          collectionJobIds: [...context.evidenceRecoveryCollectionJobIds],
        },
      },
      resultPreview: message,
      metadata: {
        outcome: 'NO_RECURRING_OPPORTUNITY',
        strongestSignalTitle: strongestSignal?.title ?? null,
        strongestSignalScore: strongestSignal?.finalScore ?? null,
        independentEvidenceCount:
          strongestSignal?.verifiedProblemMatchedEvidenceCount ??
          strongestSignal?.verifiedIndependentEvidenceCount ??
          0,
        requiredIndependentEvidenceCount:
          MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY,
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

    const recoveredAttemptOffset = primary.onlineAttemptCount;
    const attemptDiagnostics = [
      ...primary.attemptDiagnostics,
      ...recovered.attemptDiagnostics.map((item) => ({
        ...item,
        attempt: recoveredAttemptOffset + item.attempt,
      })),
    ];
    const hypothesisByKey = new Map(
      [...primary.unvalidatedDomainHypotheses, ...recovered.unvalidatedDomainHypotheses].map(
        (item) => [
          `${item.domainName.trim().toLocaleLowerCase()}::${item.title.trim().toLocaleLowerCase()}`,
          item,
        ],
      ),
    );

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
      aiAttempted: primary.aiAttempted || recovered.aiAttempted,
      aiSucceeded: primary.aiSucceeded || recovered.aiSucceeded,
      fallbackUsed: primary.fallbackUsed || recovered.fallbackUsed,
      onlineAttemptCount:
        primary.onlineAttemptCount + recovered.onlineAttemptCount,
      executionFailureCount:
        primary.executionFailureCount + recovered.executionFailureCount,
      validationRejectedCount:
        primary.validationRejectedCount + recovered.validationRejectedCount,
      fallbackReason:
        recovered.fallbackReason ?? primary.fallbackReason ?? null,
      attemptDiagnostics,
      unvalidatedDomainHypotheses: [...hypothesisByKey.values()],
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
      totalPostsAnalyzed:
        (primary.totalPostsAnalyzed ?? 0) +
        (recovered.totalPostsAnalyzed ?? 0),
      totalCommentsAnalyzed:
        (primary.totalCommentsAnalyzed ?? 0) +
        (recovered.totalCommentsAnalyzed ?? 0),
      totalTextsAnalyzed:
        (primary.totalTextsAnalyzed ?? 0) +
        (recovered.totalTextsAnalyzed ?? 0),
      dataQuality: this.mergeDataQuality(
        primary.dataQuality,
        recovered.dataQuality,
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

  /** Merges persisted NLP quality counters stored as generic Prisma JSON. */
  private mergeDataQuality(
    primary: Prisma.JsonValue | null,
    recovered: Prisma.JsonValue | null,
  ): Prisma.JsonValue {
    const readMetric = (value: Prisma.JsonValue | null, key: string): number => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return 0;
      }

      const metric = (value as Prisma.JsonObject)[key];
      return typeof metric === 'number' && Number.isFinite(metric) ? metric : 0;
    };

    return {
      spamTextsRemoved:
        readMetric(primary, 'spamTextsRemoved') +
        readMetric(recovered, 'spamTextsRemoved'),
      duplicateTextsRemoved:
        readMetric(primary, 'duplicateTextsRemoved') +
        readMetric(recovered, 'duplicateTextsRemoved'),
      irrelevantTextsRemoved:
        readMetric(primary, 'irrelevantTextsRemoved') +
        readMetric(recovered, 'irrelevantTextsRemoved'),
    };
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
    const cached = this.previousIdeaTextCache.get(domainId);
    if (cached && cached.expiresAt > Date.now()) {
      return [...cached.texts];
    }

    try {
      const previousIdeas = await this.prisma.idea.findMany({
        where: {
          domainId,
          deletedAt: null,
        },
        select: {
          title: true,
          problemStatement: true,
          partialAbstract: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });

      const texts = previousIdeas
        .map((idea) =>
          [idea.title, idea.problemStatement, idea.partialAbstract ?? ''].join(' '),
        )
        .map((text) => text.replace(/\s+/gu, ' ').trim())
        .filter(Boolean);

      this.previousIdeaTextCache.set(domainId, {
        expiresAt: Date.now() + 90_000,
        texts,
      });
      if (this.previousIdeaTextCache.size > 40) {
        const oldestKey = this.previousIdeaTextCache.keys().next().value as
          | string
          | undefined;
        if (oldestKey) this.previousIdeaTextCache.delete(oldestKey);
      }

      return texts;
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


  /**
   * Makes representative domainEvidence a first-class ranking input. The NLP
   * pipeline is intentionally bounded for speed, so direct collector evidence
   * must not disappear merely because it fell outside that top slice.
   */
  private hydrateNlpWithDomainEvidence(
    context: IdeaGenerationContext,
  ): NonNullable<IdeaGenerationContext['nlp']> {
    const nlp = context.nlp!;
    const posts = context.domainEvidence.flatMap((domain) =>
      this.readDomainEvidenceObjects(domain.samplePosts),
    );
    const comments = context.domainEvidence.flatMap((domain) =>
      this.readDomainEvidenceObjects(domain.sampleComments),
    );

    return {
      ...nlp,
      samplePosts: this.mergeDomainEvidenceJson(nlp.samplePosts, posts),
      sampleComments: this.mergeDomainEvidenceJson(nlp.sampleComments, comments),
    };
  }

  private readDomainEvidenceObjects(
    value: Prisma.JsonValue | null,
  ): Prisma.JsonValue[] {
    return Array.isArray(value) ? [...value] : [];
  }

  private mergeDomainEvidenceJson(
    existing: Prisma.JsonValue | null,
    additions: readonly Prisma.JsonValue[],
  ): Prisma.JsonArray {
    const values: Prisma.JsonValue[] = [
      ...(Array.isArray(existing) ? existing : []),
      ...additions,
    ];
    const output: Prisma.JsonValue[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const text =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Prisma.JsonObject).text
          : null;
      const key =
        typeof text === 'string'
          ? text.replace(/\s+/gu, ' ').trim().toLowerCase().slice(0, 500)
          : JSON.stringify(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
      if (output.length >= 24) break;
    }

    return output as Prisma.JsonArray;
  }

  private buildEvidenceProvenanceHints(
    context: IdeaGenerationContext,
  ): EvidenceProvenanceHint[] {
    const hints: EvidenceProvenanceHint[] = [];
    const seen = new Set<string>();

    const parseId = (
      value: string,
      expectedKind: 'post' | 'comment',
    ): { sourceKey: string; externalId: string } | null => {
      if (!value || value.startsWith('nlp:')) return null;
      const marker = `:${expectedKind}:`;
      const markerIndex = value.indexOf(marker);
      if (markerIndex <= 0) return null;
      const sourceKey = value.slice(0, markerIndex).trim();
      const externalId = value.slice(markerIndex + marker.length).trim();
      return sourceKey && externalId ? { sourceKey, externalId } : null;
    };

    for (const domain of context.domainEvidence) {
      if (Array.isArray(domain.samplePosts)) {
        for (const raw of domain.samplePosts) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          const item = raw as Prisma.JsonObject;
          const id = typeof item.id === 'string' ? item.id : '';
          const text = typeof item.text === 'string' ? item.text.trim() : '';
          if (!text) continue;

          const post = parseId(id, 'post');
          if (!post) continue;

          const key = `${post.sourceKey}|${post.externalId}|`;
          if (seen.has(key)) continue;
          seen.add(key);
          hints.push({
            text,
            sourceKey: post.sourceKey,
            postExternalId: post.externalId,
            commentExternalId: null,
          });
        }
      }

      if (!Array.isArray(domain.sampleComments)) continue;

      for (const raw of domain.sampleComments) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const item = raw as Prisma.JsonObject;
        const id = typeof item.id === 'string' ? item.id : '';
        const postId = typeof item.postId === 'string' ? item.postId : '';
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) continue;

        const comment = parseId(id, 'comment');
        const post = parseId(postId, 'post');
        if (!comment || !post || comment.sourceKey !== post.sourceKey) continue;

        const key = `${comment.sourceKey}|${post.externalId}|${comment.externalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push({
          text,
          sourceKey: comment.sourceKey,
          postExternalId: post.externalId,
          commentExternalId: comment.externalId,
        });
      }
    }

    return hints;
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
      let ranking: IdeaOpportunityRanking;

      try {
        ranking = this.opportunityRankingService.rank(
          this.hydrateNlpWithDomainEvidence(context),
          [
            context.location.country,
            context.location.city ?? '',
            context.location.region ?? '',
          ],
          previousIdeaTexts,
          context.communityAiAnalysis,
          context.selectedDomains,
        );
      } catch (error: unknown) {
        if (!(error instanceof NoRankedIdeaOpportunityError)) {
          throw error;
        }

        const groundedCommunityFallback =
          this.buildGroundedCommunityFallbackRanking(context);

        if (!groundedCommunityFallback) {
          return null;
        }

        ranking = groundedCommunityFallback;
      }

      const collectionJobIds = this.resolveEvidenceCollectionJobIds(context);
      const provenanceHints = this.buildEvidenceProvenanceHints(context);
      const verifiedRanking =
        this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            ranking,
            collectionJobIds,
            provenanceHints,
          ),
          context.selectedDomains.map((domain) => ({
            name: domain.name,
            keywords: domain.effectiveSearchKeywords ?? domain.keywords,
          })),
        );

      const verifiedHasDirectEvidence =
        verifiedRanking.selected.evidenceSamples.length > 0 ||
        (verifiedRanking.selected.verifiedProblemMatchedEvidenceCount ??
          verifiedRanking.selected.verifiedIndependentEvidenceCount ??
          0) > 0;

      if (verifiedHasDirectEvidence) {
        return verifiedRanking;
      }

      /*
       * Defensive rescue: a schema-validated Community AI opportunity with an
       * exact grounded corpus quote must not be replaced by a no-evidence
       * hypothesis merely because a generic NLP normalization rule discarded
       * it. Re-run provenance verification on the strongest grounded community
       * opportunity and keep the strict recurrence gate unchanged.
       */
      const groundedCommunityFallback =
        this.buildGroundedCommunityFallbackRanking(context);

      if (!groundedCommunityFallback) {
        return verifiedRanking;
      }

      const verifiedCommunityFallback =
        this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            groundedCommunityFallback,
            collectionJobIds,
            provenanceHints,
          ),
          context.selectedDomains.map((domain) => ({
            name: domain.name,
            keywords: domain.effectiveSearchKeywords ?? domain.keywords,
          })),
        );
      const fallbackHasDirectEvidence =
        verifiedCommunityFallback.selected.evidenceSamples.length > 0 ||
        (verifiedCommunityFallback.selected.verifiedProblemMatchedEvidenceCount ??
          verifiedCommunityFallback.selected.verifiedIndependentEvidenceCount ??
          0) > 0;

      if (fallbackHasDirectEvidence) {
        return verifiedCommunityFallback;
      }

      /*
       * Final provenance-safe rescue. Community AI is allowed to fail or return
       * an empty array, but an exact retained direct complaint in domainEvidence
       * must never be converted into a no-evidence validation hypothesis. Build
       * a conservative candidate from the verbatim retained text and pass it
       * through the same independent DB verification service before accepting it.
       */
      const directDomainFallback =
        this.buildDirectDomainEvidenceFallbackRanking(context);

      if (!directDomainFallback) {
        return verifiedRanking;
      }

      const verifiedDirectDomainFallback =
        this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            directDomainFallback,
            collectionJobIds,
            provenanceHints,
          ),
          context.selectedDomains.map((domain) => ({
            name: domain.name,
            keywords: domain.effectiveSearchKeywords ?? domain.keywords,
          })),
        );
      const directFallbackHasEvidence =
        verifiedDirectDomainFallback.selected.evidenceSamples.length > 0 ||
        (verifiedDirectDomainFallback.selected.verifiedIndependentEvidenceCount ??
          0) > 0;

      return directFallbackHasEvidence
        ? verifiedDirectDomainFallback
        : verifiedRanking;
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
   * Builds a conservative ranking record from the strongest schema-validated
   * Community AI opportunity when the generic NLP candidate normalizer drops
   * that opportunity. This is a rescue path, not an eligibility bypass:
   * independent provenance verification still runs immediately afterward and
   * recurrence/source-diversity requirements remain unchanged.
   */
  private buildDirectDomainEvidenceFallbackRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking | null {
    const selectedDomainNames = new Set(
      context.selectedDomains.map((domain) => domain.name.trim().toLowerCase()),
    );
    const candidateEvidence = context.domainEvidence.filter(
      (entry) =>
        selectedDomainNames.size === 0 ||
        selectedDomainNames.has(entry.domainName.trim().toLowerCase()),
    );

    const candidates = candidateEvidence
      .flatMap((domainEvidence) =>
        this.readDomainEvidenceTexts(domainEvidence.sampleComments).map((sample) => ({
          sample,
          domainName: domainEvidence.domainName,
          domainId: domainEvidence.domainId,
        })),
      )
      .map((entry) => ({
        ...entry,
        sample: entry.sample.replace(/\s+/gu, ' ').trim(),
      }))
      .filter((entry) => entry.sample.length >= 20)
      .map((entry) => {
        const sample = entry.sample;
        const body = sample.replace(
          /^.*?\bCommunity comment:\s*/isu,
          '',
        ).trim();
        const directKind = classifyDirectCommunityEvidence(body, 'COMMENT');
        let score = Math.min(body.length, 320) / 100;
        if (directKind === 'USER_COMPLAINT') score += 8;
        if (directKind === 'FEATURE_REQUEST') score += 6;
        if (/\b(?:cannot|can['’]?t|unable|fail|error|wrong|crash|slow|delay|wait|missing|risk|unsafe|bias|liability|privacy|problem|issue|struggle|difficult)\b/iu.test(body)) {
          score += 3;
        }
        return { ...entry, sample, body, directKind, score };
      })
      .filter(
        (item) =>
          item.directKind === 'USER_COMPLAINT' ||
          item.directKind === 'FEATURE_REQUEST',
      )
      .sort((first, second) => second.score - first.score);

    const strongest = candidates[0];
    if (!strongest) {
      return null;
    }

    const problem = strongest.body
      .split(/(?<=[.!?])\s+/u)
      .find((sentence) => {
        const kind = classifyDirectCommunityEvidence(sentence, 'COMMENT');
        return kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST';
      }) ?? strongest.body;
    const boundedProblem = problem.slice(0, 260).trim();
    const titleWords = boundedProblem
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(' ')
      .slice(0, 10)
      .join(' ');
    const title = titleWords.length >= 18
      ? titleWords
      : `${strongest.domainName} Direct Community Problem`;

    return {
      selected: {
        rank: 1,
        title,
        problem: boundedProblem,
        need:
          'A focused software response that addresses the retained direct community problem while validating broader recurrence during the pilot.',
        solutionArea:
          'Evidence-grounded diagnosis, guided resolution, and pilot validation workflow.',
        evidenceType: 'OPPORTUNITY',
        sourceIndex: 0,
        frequency: 1,
        severity: 'MEDIUM',
        evidenceSamples: [strongest.sample],
        frequencyScore: 0.2,
        severityScore: 0.6,
        evidenceScore: 0.2,
        evidenceReliabilityScore: 0.9,
        weakEvidencePenalty: 0.08,
        specificityScore: 0.86,
        feasibilityScore: 0.72,
        localRelevanceScore: 0.25,
        noveltyScore: 0.5,
        businessValueScore: 0.5,
        marketGapScore: 0.45,
        competitionScore: 0.5,
        technicalRiskScore: 0.28,
        supportScore: 0.72,
        nlpConfidenceScore: context.nlp?.confidence ?? 0.4,
        baseScore: 0.58,
        confidencePenalty: 0.04,
        finalScore: 0.5,
        matchedDomainNames: [strongest.domainName],
        domainRelevanceScores: { [strongest.domainName]: 1 },
        selectionEligible: false,
        disqualificationReasons: [
          'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
        ],
        verifiedIndependentEvidenceCount: 0,
        verifiedIndependentSourceCount: 0,
        independentEvidence: [],
        raw: {
          title,
          source: 'DIRECT_DOMAIN_EVIDENCE_FALLBACK',
          problem: boundedProblem,
          unmetNeed:
            'A focused software response that addresses the retained direct community problem while validating broader recurrence during the pilot.',
          domainName: strongest.domainName,
          solutionArea:
            'Evidence-grounded diagnosis, guided resolution, and pilot validation workflow.',
          evidenceSamples: [strongest.sample],
          groundingScore: 100,
        } as unknown as Prisma.JsonValue,
      },
      alternatives: [],
      evaluatedCount: 1,
      evidenceCoverage: 1,
      selectionReason:
        `Recovered one exact direct complaint from retained selected-domain evidence for "${strongest.domainName}" after the Community AI path did not produce a provenance-verifiable candidate. Independent DB verification remains mandatory.`,
      qualityWarnings: [
        'Only one independently retained direct report supports this opportunity; claims must remain preliminary until recurrence is validated.',
      ],
    };
  }

  private buildGroundedCommunityFallbackRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking | null {
    const analysis = context.communityAiAnalysis;

    if (!analysis) {
      return null;
    }

    const selectedDomainNames = new Set(
      context.selectedDomains
        .map((domain) => domain.name.trim().toLowerCase())
        .filter(Boolean),
    );
    if (selectedDomainNames.size === 0 && context.domainName?.trim()) {
      selectedDomainNames.add(context.domainName.trim().toLowerCase());
    }

    const candidates = analysis.opportunities
      .filter((opportunity) => {
        const evidenceSamples = opportunity.evidenceSamples
          .map((sample) => sample.replace(/\s+/gu, ' ').trim())
          .filter(Boolean);
        const domainMatches =
          selectedDomainNames.size === 0 ||
          selectedDomainNames.has(opportunity.domainName.trim().toLowerCase());

        return (
          domainMatches &&
          evidenceSamples.length > 0 &&
          opportunity.groundingScore >= 50
        );
      })
      .sort(
        (first, second) =>
          second.groundingScore - first.groundingScore ||
          second.confidence - first.confidence ||
          second.problemImportance - first.problemImportance,
      );

    const opportunity = candidates[0];

    if (!opportunity) {
      return null;
    }

    const evidenceSamples = opportunity.evidenceSamples
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, 3);
    const confidence = Math.max(0, Math.min(1, opportunity.confidence / 100));
    const grounding = Math.max(
      0,
      Math.min(1, opportunity.groundingScore / 100),
    );
    const evidenceScore = Math.min(1, evidenceSamples.length / 5);
    const reliability = Number(
      Math.max(0.7, grounding * 0.8 + confidence * 0.2).toFixed(4),
    );
    const supportScore = Number(
      Math.min(1, reliability * 0.7 + evidenceScore * 0.3).toFixed(4),
    );
    const baseScore = Number(
      Math.min(
        1,
        supportScore * 0.4 +
          (opportunity.problemImportance / 100) * 0.25 +
          (opportunity.technicalFeasibility / 100) * 0.2 +
          (opportunity.innovationPotential / 100) * 0.15,
      ).toFixed(4),
    );
    const weakEvidencePenalty = evidenceSamples.length === 1 ? 0.08 : 0.04;
    const finalScore = Number(
      Math.max(0, baseScore - weakEvidencePenalty).toFixed(4),
    );

    return {
      selected: {
        rank: 1,
        title: opportunity.title,
        problem: opportunity.problem,
        need: opportunity.unmetNeed,
        solutionArea: opportunity.solutionArea,
        evidenceType: 'OPPORTUNITY',
        sourceIndex: 0,
        frequency: evidenceSamples.length,
        severity: opportunity.severity,
        evidenceSamples,
        frequencyScore: Math.min(1, evidenceSamples.length / 5),
        severityScore:
          opportunity.severity === 'CRITICAL'
            ? 1
            : opportunity.severity === 'HIGH'
              ? 0.85
              : opportunity.severity === 'MEDIUM'
                ? 0.6
                : 0.35,
        evidenceScore,
        evidenceReliabilityScore: reliability,
        weakEvidencePenalty,
        specificityScore: 0.82,
        feasibilityScore: opportunity.technicalFeasibility / 100,
        localRelevanceScore: opportunity.localEvidenceAvailable
          ? opportunity.localRelevance / 100
          : 0.25,
        noveltyScore: opportunity.innovationPotential / 100,
        businessValueScore: opportunity.marketPotential / 100,
        marketGapScore: Math.max(0.4, opportunity.marketPotential / 100 - 0.1),
        competitionScore: 0.5,
        technicalRiskScore: 1 - opportunity.technicalFeasibility / 100,
        supportScore,
        nlpConfidenceScore: context.nlp?.confidence ?? confidence,
        baseScore,
        confidencePenalty: Number(((1 - confidence) * 0.08).toFixed(4)),
        finalScore,
        matchedDomainNames: [opportunity.domainName],
        domainRelevanceScores: { [opportunity.domainName]: 1 },
        selectionEligible: false,
        disqualificationReasons: [
          'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
        ],
        verifiedIndependentEvidenceCount: 0,
        verifiedIndependentSourceCount: 0,
        independentEvidence: [],
        raw: {
          ...opportunity,
          source: 'COMMUNITY_AI_ANALYSIS',
        } as unknown as Prisma.JsonValue,
      },
      alternatives: [],
      evaluatedCount: analysis.opportunities.length,
      evidenceCoverage: Number(
        Math.min(1, evidenceSamples.length / 3).toFixed(4),
      ),
      selectionReason:
        `Recovered schema-validated grounded Community AI opportunity "${opportunity.title}" after generic NLP normalization produced no direct-evidence ranking. Independent recurrence verification remains required.`,
      qualityWarnings: [
        `Only ${evidenceSamples.length} direct grounded evidence sample(s) support the selected opportunity; claims must remain preliminary and must not be presented as market-wide facts.`,
        'The requested location remains a pilot deployment target unless direct local evidence is independently verified.',
      ],
    };
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
      ...context.domainEvidence.map((entry) => entry.collectionJobId),
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
    return this.buildPrimaryDomainHypothesisRanking(context);
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
    const directEvidenceCount = Math.max(
      selected.evidenceSamples.length,
      selected.independentEvidence?.length ?? 0,
      selected.verifiedProblemMatchedDirectUserEvidenceCount ??
        selected.verifiedIndependentEvidenceCount ??
        0,
    );
    const independentSourceCount = Math.max(
      selected.verifiedProblemMatchedSourceCount ??
        selected.verifiedIndependentSourceCount ??
        0,
      new Set(
        (selected.independentEvidence ?? [])
          .map((evidence) => evidence.sourceKey)
          .filter(Boolean),
      ).size,
    );

    /*
     * Recovery is justified only for a sparse winning cluster: zero/one direct
     * sample or evidence coming from a single independent source. A cluster with
     * multiple reports across multiple sources is already useful and must not
     * pay the 20-30 second recovery penalty.
     */
    return directEvidenceCount <= 1 || independentSourceCount <= 1;
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
    const intentAlignedRanking = this.applyRequestIntentAlignment(ranking, context);
    const normalizedRanking = this.normalizeFinalRankingWarnings(
      this.normalizeFinalRankingEvidenceCoverage(intentAlignedRanking),
    );
    const winnerDomain = this.resolveWinnerPrimaryDomain(
      context,
      normalizedRanking,
    );
    const winnerContext: IdeaGenerationContext = winnerDomain
      ? {
          ...context,
          domainId: winnerDomain.id,
          domainName: winnerDomain.name,
        }
      : context;
    const synchronizedDomainEvidence = this.synchronizeSelectedOpportunityEvidence(
      winnerContext,
      normalizedRanking,
    );

    const updatedContext: IdeaGenerationContext = {
      ...winnerContext,
      domainEvidence: synchronizedDomainEvidence,
      opportunityRanking: normalizedRanking,
      // A previous checkpoint or retry must never keep a stale terminal
      // no-result marker once this stage has selected a controlled fallback.
      noResultOutcome: null,
    };

    return {
      context: updatedContext,
      resultPreview: normalizedRanking.selected.selectionEligible
        ? recoveryApplied
          ? `Targeted evidence recovery completed; ranked ${normalizedRanking.evaluatedCount} candidate(s) and selected opportunity "${normalizedRanking.selected.title}" with score ${(normalizedRanking.selected.finalScore * 100).toFixed(1)}.`
          : `Ranked ${ranking.evaluatedCount} opportunity candidate(s); selected opportunity "${normalizedRanking.selected.title}" with score ${(normalizedRanking.selected.finalScore * 100).toFixed(1)}. ${normalizedRanking.selectionReason}`
        : recoveryApplied
          ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot after one focused evidence-recovery pass. Idea generation will continue, while sparse-evidence claims remain explicitly qualified.`
          : Math.max(
                normalizedRanking.selected.evidenceSamples.length,
                normalizedRanking.selected.independentEvidence?.length ?? 0,
                normalizedRanking.selected.verifiedProblemMatchedEvidenceCount ??
                  normalizedRanking.selected.verifiedEvidenceCount ??
                  0,
              ) > 0
            ? (normalizedRanking.selected.verifiedProblemMatchedDirectUserEvidenceCount ??
                normalizedRanking.selected.verifiedDirectUserEvidenceCount ??
                normalizedRanking.selected.verifiedIndependentEvidenceCount ??
                0) > 0
              ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained direct-user evidence. The evidence is insufficient for independent recurrence, so claims remain explicitly qualified.`
              : (normalizedRanking.selected.verifiedProblemMatchedSecondaryEvidenceCount ??
                  normalizedRanking.selected.verifiedSecondaryEvidenceCount ??
                  0) > 0
                ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained secondary evidence. No verified direct user complaint establishes recurrence, so claims remain explicitly qualified.`
                : (normalizedRanking.selected.verifiedProblemMatchedTechnicalEvidenceCount ??
                    normalizedRanking.selected.verifiedTechnicalEvidenceCount ??
                    0) > 0
                  ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained technical evidence. No verified direct user complaint establishes recurrence, so claims remain explicitly qualified.`
                  : `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained evidence. No verified direct user complaint establishes recurrence, so claims remain explicitly qualified.`
            : `Selected a controlled primary-domain validation hypothesis "${normalizedRanking.selected.title}" because no problem-matched retained evidence was verified. The generated idea must remain explicitly unvalidated.`,
      metadata: {
        selectedTitle: normalizedRanking.selected.title,
        selectedScore: normalizedRanking.selected.finalScore,
        selectedEligible: normalizedRanking.selected.selectionEligible,
        matchedDomainNames: normalizedRanking.selected.matchedDomainNames ?? [],
        problemDomainNames: normalizedRanking.selected.problemDomainNames ?? [],
        workflowDomainNames: normalizedRanking.selected.workflowDomainNames ?? [],
        primaryMatchedDomainName:
          normalizedRanking.selected.primaryMatchedDomainName ?? null,
        evidenceRecoveryApplied: recoveryApplied,
        evidenceRecoveryAttempts: updatedContext.evidenceRecoveryAttempts,
        evidenceRecovery: recoveryMetadata,
        shortlistedOpportunities: [
          normalizedRanking.selected,
          ...normalizedRanking.alternatives.slice(0, 4),
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
          matchedDomainNames: opportunity.matchedDomainNames ?? [],
          problemDomainNames: opportunity.problemDomainNames ?? [],
          workflowDomainNames: opportunity.workflowDomainNames ?? [],
          primaryMatchedDomainName: opportunity.primaryMatchedDomainName ?? null,
          domainRelevanceScores: opportunity.domainRelevanceScores ?? {},
          problemDomainRelevanceScores:
            opportunity.problemDomainRelevanceScores ?? {},
          workflowDomainRelevanceScores:
            opportunity.workflowDomainRelevanceScores ?? {},
          disqualificationReasons: opportunity.disqualificationReasons,
        })),
        selectionReason: normalizedRanking.selectionReason,
        evidenceCoverage: normalizedRanking.evidenceCoverage,
        evaluatedCount: normalizedRanking.evaluatedCount,
        qualityWarnings: [...normalizedRanking.qualityWarnings],
      },
    };
  }

  /**
   * Removes stale pre-verification fallback warnings once independent evidence
   * verification has promoted the selected candidate to an eligible, traceable
   * preliminary opportunity. The numeric score is intentionally left untouched:
   * one verified report can justify a pilot while still being below recurrence
   * and market-confidence thresholds.
   */
  private applyRequestIntentAlignment(
    ranking: IdeaOpportunityRanking,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const description = context.requestDescription?.trim();
    if (!description) return ranking;

    /*
     * Intent is a selection gate, not merely another small ranking weight.
     * A strongly evidenced login/authentication problem must not become the
     * primary result for a request about student homework when its alignment is
     * effectively zero. The lower band remains usable as a preliminary,
     * explicitly warned fallback so sparse data does not turn into FAILED.
     */
    const normalizedDescription = this.normalizeIntentText(description);
    const intentConceptCount =
      this.resolveIntentConceptGroups(normalizedDescription).length;
    const STRONG_INTENT_ALIGNMENT =
      intentConceptCount >= 3 ? 0.58 : intentConceptCount === 2 ? 0.52 : 0.45;
    const PRELIMINARY_INTENT_ALIGNMENT =
      intentConceptCount >= 3 ? 0.46 : intentConceptCount === 2 ? 0.36 : 0.28;
    const originalCandidates = [ranking.selected, ...ranking.alternatives];

    const scored = originalCandidates.map((candidate) => {
      const rawCandidate =
        candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
          ? (candidate.raw as Prisma.JsonObject)
          : null;
      const rawSource =
        rawCandidate && typeof rawCandidate.source === 'string'
          ? rawCandidate.source
          : null;
      const rawRequestDescription =
        rawCandidate && typeof rawCandidate.requestDescription === 'string'
          ? rawCandidate.requestDescription.trim()
          : '';
      const isCanonicalRequesterHypothesis =
        rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS' &&
        rawRequestDescription.length > 0 &&
        this.normalizeIntentText(rawRequestDescription) === normalizedDescription;
      const alignment = isCanonicalRequesterHypothesis
        ? 1
        : this.calculateRequestIntentAlignment(candidate, description);
      const adjusted = Math.max(
        0,
        Math.min(1, candidate.finalScore * 0.72 + alignment * 0.28),
      );
      const isOffSelectedDomain = candidate.disqualificationReasons.includes(
        'OFF_SELECTED_DOMAIN',
      );
      const isStronglyAligned = alignment >= STRONG_INTENT_ALIGNMENT;
      const isPreliminaryAligned = alignment >= PRELIMINARY_INTENT_ALIGNMENT;
      const requestIntentSupportTier = isStronglyAligned
        ? 'FULL_REQUEST_MATCH' as const
        : alignment >= 0.24
          ? 'PARTIAL_REQUEST_SUPPORT' as const
          : 'WEAK_OR_UNRELATED' as const;
      const disqualificationReasons = [...candidate.disqualificationReasons];

      if (!isStronglyAligned && !disqualificationReasons.includes('WEAK_REQUEST_INTENT_ALIGNMENT')) {
        disqualificationReasons.push('WEAK_REQUEST_INTENT_ALIGNMENT');
      }
      if (!isPreliminaryAligned && !disqualificationReasons.includes('REQUEST_INTENT_MISMATCH')) {
        disqualificationReasons.push('REQUEST_INTENT_MISMATCH');
      }

      const selectionEligible =
        candidate.selectionEligible &&
        !isOffSelectedDomain &&
        isStronglyAligned;
      const raw =
        candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
          ? {
              ...(candidate.raw as Prisma.JsonObject),
              requestIntentAlignmentScore: alignment,
              requestIntentAdjustedScore: adjusted,
              requestIntentSupportTier,
              requestIntentSelectionTier: isStronglyAligned
                ? 'STRONG_ALIGNED'
                : isPreliminaryAligned
                  ? 'PRELIMINARY_ALIGNED'
                  : 'MISMATCH_FALLBACK_ONLY',
            }
          : candidate.raw;

      return {
        ...candidate,
        finalScore: adjusted,
        requestIntentAlignmentScore: alignment,
        requestIntentAdjustedScore: adjusted,
        requestIntentSupportTier,
        selectionEligible,
        disqualificationReasons,
        raw,
      };
    });

    const strongEligible = scored
      .filter((candidate) => candidate.selectionEligible)
      .sort((left, right) => right.finalScore - left.finalScore);
    const preliminaryAligned = scored
      .filter(
        (candidate) =>
          !candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') &&
          (candidate.requestIntentAlignmentScore ?? 0) >= PRELIMINARY_INTENT_ALIGNMENT,
      )
      .sort((left, right) =>
        (right.requestIntentAlignmentScore ?? 0) -
          (left.requestIntentAlignmentScore ?? 0) ||
        right.finalScore - left.finalScore,
      );

    const partialSupportCandidates = scored.filter(
      (candidate) =>
        !candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') &&
        candidate.requestIntentSupportTier === 'PARTIAL_REQUEST_SUPPORT',
    );

    if (strongEligible.length === 0) {
      const fallback = this.buildPrimaryDomainHypothesisRanking(context);
      const mismatchAlternatives = scored
        .sort(
          (left, right) =>
            (right.requestIntentAlignmentScore ?? 0) -
              (left.requestIntentAlignmentScore ?? 0) ||
            right.finalScore - left.finalScore,
        )
        .slice(0, 4)
        .map((candidate, index) => ({ ...candidate, rank: index + 2 }));

      return {
        ...fallback,
        alternatives: mismatchAlternatives,
        evaluatedCount: Math.max(fallback.evaluatedCount, ranking.evaluatedCount),
        qualityWarnings: [
          ...(partialSupportCandidates.length > 0 ||
          preliminaryAligned.length > 0
            ? [
                `${Math.max(partialSupportCandidates.length, preliminaryAligned.length)} retained evidence candidate(s) support only part of the requester-described workflow. Because none passed the strong requester-intent gate, they remain supporting context and cannot replace the primary requester-defined problem.`,
              ]
            : [
                `The collected evidence was stronger for problems that did not materially match the requester description "${description}". Those candidates were retained only as fallback diagnostics and were not allowed to become the primary idea.`,
              ]),
          ...fallback.qualityWarnings,
        ],
        selectionReason: `No retained evidence candidate passed the strong requester-intent gate for "${description}". The pipeline preserved the requester-defined problem as the primary validation direction and kept partial evidence only as supporting context.`,
      };
    }

    const winner = strongEligible[0];
    const explicitPrimaryDomain =
      context.domainResolution?.source === 'USER_SELECTED'
        ? context.domainResolution.selectedDomain.name.trim()
        : '';
    const winnerClaimDomains = new Set(
      (winner.matchedDomainNames ?? [])
        .map((name) => name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );

    if (
      explicitPrimaryDomain &&
      context.selectedDomains.length <= 1 &&
      !winnerClaimDomains.has(explicitPrimaryDomain.toLocaleLowerCase())
    ) {
      const fallback = this.buildPrimaryDomainHypothesisRanking(context);
      const diagnosticAlternatives = scored
        .sort((left, right) => right.finalScore - left.finalScore)
        .slice(0, 4)
        .map((candidate, index) => ({ ...candidate, rank: index + 2 }));

      return {
        ...fallback,
        alternatives: diagnosticAlternatives,
        evaluatedCount: Math.max(fallback.evaluatedCount, ranking.evaluatedCount),
        qualityWarnings: [
          `The strongest request-aligned evidence did not include the explicitly selected domain "${explicitPrimaryDomain}". The final direction therefore remains a cross-domain validation hypothesis instead of silently dropping the user's selected domain or inventing unsupported cross-domain evidence.`,
          ...fallback.qualityWarnings,
        ],
        selectionReason: `The requester explicitly selected "${explicitPrimaryDomain}" and supplied a description whose strongest retained evidence pointed elsewhere. Because no verified coherent bundle connected both sides, the pipeline preserved both as a cross-domain validation scope rather than ignoring either input.`,
      };
    }

    const ordered = [winner, ...scored.filter((candidate) => candidate !== winner)]
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const isPreliminaryWinner = false;
    const changed = winner.title !== ranking.selected.title;

    return {
      ...ranking,
      selected: ordered[0],
      alternatives: ordered.slice(1),
      selectionReason: isPreliminaryWinner
        ? `No candidate passed the strong requester-intent gate. Selected the best weak-but-aligned preliminary opportunity for "${description}" instead of promoting an unrelated high-evidence problem.`
        : changed
          ? `Selected the strongest evidence-backed opportunity that also passed the requester-intent gate for: ${description}`
          : ranking.selectionReason,
      qualityWarnings: [
        ...(isPreliminaryWinner
          ? [
              'The selected direction is only weakly aligned to the explicit requester intent and must be presented as a preliminary validation candidate.',
            ]
          : []),
        ...(changed
          ? [
              `Requester-intent gating changed the preferred opportunity from "${ranking.selected.title}" to "${winner.title}".`,
            ]
          : []),
        ...ranking.qualityWarnings,
      ],
    };
  }

  private calculateRequestIntentAlignment(
    candidate: IdeaOpportunityRanking['selected'],
    description: string,
  ): number {
    const candidateText = this.normalizeIntentText(
      [
        candidate.title,
        candidate.problem ?? '',
        candidate.need ?? '',
        candidate.solutionArea ?? '',
        ...candidate.evidenceSamples,
        ...(candidate.relatedOpportunityBundle ?? []).flatMap((item) => [
          item.title,
          item.problem ?? '',
          item.need ?? '',
          item.solutionArea ?? '',
          ...item.evidenceSamples,
        ]),
      ].join(' '),
    );
    const requestText = this.normalizeIntentText(description);
    const requestTokens = this.extractIntentTokens(requestText);
    const candidateTokens = this.extractIntentTokens(candidateText);
    const lexicalMatches = [...requestTokens].filter((token) =>
      candidateTokens.has(token),
    ).length;
    const lexicalScore =
      requestTokens.size > 0 ? lexicalMatches / requestTokens.size : 0.5;

    const conceptGroups = this.resolveIntentConceptGroups(requestText);
    const matchedConceptCount = conceptGroups.filter((group) =>
      group.some((term) => candidateText.includes(term)),
    ).length;
    const conceptScore =
      conceptGroups.length > 0
        ? matchedConceptCount / conceptGroups.length
        : lexicalScore;

    const rawAlignment = Math.max(
      0,
      Math.min(1, lexicalScore * 0.3 + conceptScore * 0.7),
    );
    const requiredAnchors = this.resolveRequiredIntentAnchors(requestText);
    const missingRequiredAnchor = requiredAnchors.some(
      (group) => !group.some((term) => candidateText.includes(term)),
    );

    const hasMaterialPartialSupport =
      missingRequiredAnchor &&
      conceptGroups.length >= 2 &&
      matchedConceptCount >= 2 &&
      conceptScore >= 0.5;

    return missingRequiredAnchor
      ? Math.min(rawAlignment, hasMaterialPartialSupport ? 0.44 : 0.12)
      : rawAlignment;
  }

  private resolveRequiredIntentAnchors(requestText: string): readonly string[][] {
    const anchors: string[][] = [];

    if (/\b(?:homework|assignment|coursework|worksheet|schoolwork)\b/u.test(requestText)) {
      anchors.push([
        'homework',
        'assignment',
        'coursework',
        'worksheet',
        'schoolwork',
        'submit',
        'submission',
        'due date',
        'grading',
        'grade',
      ]);
    }

    if (/\b(?:login|log in|sign in|signin|authentication|authenticate|oauth|password|account access)\b/u.test(requestText)) {
      anchors.push([
        'login',
        'log in',
        'sign in',
        'signin',
        'authentication',
        'authenticate',
        'oauth',
        'password',
        'account access',
      ]);
    }

    if (
      /\b(?:cybersecurity|cyber security|security|unauthorized access|unauthorised access|data breach|security breach|suspicious activity|security alert|threat|attack|incident response|malware|ransomware|phishing|vulnerability|credential|access control)\b/u.test(
        requestText,
      )
    ) {
      anchors.push([
        'cybersecurity',
        'cyber security',
        'security',
        'unauthorized access',
        'unauthorised access',
        'data breach',
        'security breach',
        'suspicious activity',
        'security alert',
        'threat',
        'attack',
        'incident response',
        'malware',
        'ransomware',
        'phishing',
        'vulnerability',
        'credential',
        'access control',
        'authentication',
        'privacy',
      ]);
    }

    if (
      /\b(?:human resources|\bhr\b|recruitment|recruiting|hiring|talent acquisition|candidate|applicant|employee onboarding|burnout|turnover|retention|workload|employee feedback)\b/u.test(
        requestText,
      ) ||
      (/\b(?:employee|employees|workforce|staff)\b/u.test(requestText) &&
        /\b(?:burnout|turnover|retention|workload|wellbeing|well being|engagement|performance review|staffing shortage|recruitment|hiring|onboarding)\b/u.test(
          requestText,
        ))
    ) {
      anchors.push([
        'human resources',
        'hr',
        'employee',
        'employees',
        'workforce',
        'staff',
        'recruitment',
        'hiring',
        'burnout',
        'turnover',
        'retention',
        'workload',
        'wellbeing',
        'well being',
        'engagement',
        'onboarding',
      ]);
    }

    if (/\b(?:recruitment|recruiting|hiring|candidate|candidates|applicant|applicants|talent acquisition)\b/u.test(requestText)) {
      anchors.push([
        'recruitment',
        'recruiting',
        'hiring',
        'candidate',
        'candidates',
        'applicant',
        'applicants',
        'talent acquisition',
      ]);
    }

    if (/\b(?:expense|expenses|cost|costs|spending|budget|waste|wasted|financial|finance)\b/u.test(requestText)) {
      anchors.push([
        'expense',
        'expenses',
        'cost',
        'costs',
        'spending',
        'budget',
        'waste',
        'wasted',
        'financial',
        'finance',
        'money',
      ]);
    }

    if (/\b(?:administrative|administration|admin work|paperwork|back office|repetitive task|repetitive tasks)\b/u.test(requestText)) {
      anchors.push([
        'administrative',
        'administration',
        'admin',
        'paperwork',
        'back office',
        'repetitive task',
        'repetitive tasks',
        'automation',
      ]);
    }

    if (/\b(?:detect|identify|early|emerging|analyze|analyse|analytics|insight|insights|scattered|fragmented|feedback|records|data)\b/u.test(requestText)) {
      anchors.push([
        'detect',
        'detection',
        'identify',
        'early',
        'emerging',
        'analyze',
        'analyse',
        'analytics',
        'insight',
        'insights',
        'feedback',
        'record',
        'records',
        'data',
        'trend',
        'warning',
        'anomaly',
      ]);
    }

    if (
      /\b(?:tailor|tailoring|custom clothing|custom apparel|bespoke|garment|made to measure)\b/u.test(
        requestText,
      )
    ) {
      anchors.push([
        'tailor',
        'tailoring',
        'custom clothing',
        'custom apparel',
        'bespoke',
        'garment',
        'made to measure',
      ]);
    }

    return anchors;
  }

  private resolveIntentConceptGroups(requestText: string): readonly string[][] {
    const groups: string[][] = [];
    const definitions: readonly { readonly trigger: RegExp; readonly terms: readonly string[] }[] = [
      {
        trigger: /\b(?:homework|assignment|coursework|worksheet|schoolwork)\b/u,
        terms: ['homework', 'assignment', 'coursework', 'worksheet', 'schoolwork', 'submit', 'submission', 'due', 'feedback', 'grade'],
      },
      {
        trigger: /\b(?:student|students|school|teacher|education|learning|classroom|course|lesson)\b/u,
        terms: ['student', 'students', 'school', 'teacher', 'education', 'learning', 'classroom', 'course', 'lesson', 'assignment', 'homework'],
      },
      {
        trigger: /\b(?:login|log in|sign in|signin|authentication|authenticate|oauth|password|account access)\b/u,
        terms: ['login', 'log in', 'sign in', 'signin', 'authentication', 'authenticate', 'oauth', 'password', 'account access'],
      },
      {
        trigger: /\b(?:cybersecurity|cyber security|security|unauthorized access|unauthorised access|data breach|security breach|suspicious activity|security alert|threat|attack|incident response|malware|ransomware|phishing|vulnerability|credential|access control)\b/u,
        terms: [
          'cybersecurity',
          'cyber security',
          'security',
          'unauthorized access',
          'unauthorised access',
          'data breach',
          'security breach',
          'suspicious activity',
          'security alert',
          'threat',
          'attack',
          'incident response',
          'malware',
          'ransomware',
          'phishing',
          'vulnerability',
          'credential',
          'access control',
          'authentication',
          'privacy',
        ],
      },
      {
        trigger: /\b(?:admin|administration|administrative|back office|operations?)\b/u,
        terms: ['admin', 'administration', 'administrative', 'back office', 'operations', 'approval', 'workflow', 'paperwork'],
      },
      {
        trigger: /\b(?:financ|financial|accounting|budget|expense|invoice|payroll|procurement|reconcil|cash flow|payment)\w*\b/u,
        terms: ['finance', 'financial', 'accounting', 'budget', 'expense', 'invoice', 'payroll', 'procurement', 'reconciliation', 'cash flow', 'payment'],
      },
      {
        trigger: /\b(?:human resources|\bhr\b|recruitment|recruiting|hiring|talent acquisition|candidate|applicant|employee onboarding|burnout|turnover|retention|workload|employee feedback)\b/u,
        terms: ['human resources', 'hr', 'employee', 'employees', 'workforce', 'staff', 'recruitment', 'hiring', 'candidate', 'applicant', 'burnout', 'turnover', 'retention', 'workload', 'wellbeing', 'onboarding'],
      },
      {
        trigger: /\b(?:recruitment|recruiting|hiring|candidate|candidates|applicant|applicants|talent acquisition)\b/u,
        terms: ['recruitment', 'recruiting', 'hiring', 'candidate', 'candidates', 'applicant', 'applicants', 'talent acquisition'],
      },
      {
        trigger: /\b(?:cost|costs|expense|expenses|spending|waste|wasted|budget)\b/u,
        terms: ['cost', 'costs', 'expense', 'expenses', 'spending', 'waste', 'wasted', 'budget', 'money'],
      },
      {
        trigger: /\b(?:detect|identify|early|emerging|analyze|analyse|analytics|insight|insights|scattered|fragmented|feedback|records|data)\b/u,
        terms: ['detect', 'detection', 'identify', 'early', 'emerging', 'analyze', 'analyse', 'analytics', 'insight', 'insights', 'feedback', 'record', 'records', 'data', 'trend', 'warning', 'anomaly'],
      },
      {
        trigger: /\b(?:fraud|fraudulent|chargeback|chargebacks|account takeover|account takeovers|payment dispute|payment disputes|false decline|false declines|legitimate purchase|legitimate purchases|suspicious transaction|suspicious transactions)\b/u,
        terms: ['fraud', 'fraudulent', 'chargeback', 'chargebacks', 'account takeover', 'payment dispute', 'false decline', 'legitimate purchase', 'suspicious transaction', 'risk scoring', 'blocked purchase', 'fraud detection'],
      },
      {
        trigger: /\b(?:laundry|laundromat|dry cleaning|dry-cleaning|dry cleaner|garment cleaning|wash and fold)\b/u,
        terms: ['laundry', 'laundromat', 'dry cleaning', 'dry-cleaning', 'dry cleaner', 'garment', 'garments', 'stain', 'cleaning instruction', 'pickup', 'deadline', 'treatment', 'lost garment', 'delayed order', 'paper tag'],
      },
      {
        trigger: /\b(?:tailor|tailoring|custom clothing|custom apparel|bespoke|garment|made to measure)\b/u,
        terms: ['tailor', 'tailoring', 'custom clothing', 'custom apparel', 'bespoke', 'garment', 'made to measure'],
      },
      {
        trigger: /\b(?:measurement|measurements|fabric|alteration|fitting|custom order|clothing order|design notes?)\b/u,
        terms: ['measurement', 'measurements', 'fabric', 'alteration', 'fitting', 'custom order', 'clothing order', 'design note', 'order details'],
      },
      {
        trigger: /\b(?:paper|messages?|previous measurements?|history|historical|returning customers?|recorded|records?)\b/u,
        terms: ['paper', 'message', 'messages', 'previous measurement', 'history', 'historical', 'returning customer', 'record', 'records', 'order details'],
      },
      {
        trigger: /\b(?:mistake|mistakes|repeated fittings?|delay|delayed orders?|follow ups?|poor management)\b/u,
        terms: ['mistake', 'mistakes', 'repeated fitting', 'delay', 'delayed', 'delivery', 'follow up', 'poor management', 'order not ready'],
      },
      {
        trigger: /\b(?:company|business|organization|organisation|enterprise|department|office|staff|team)\b/u,
        terms: ['company', 'business', 'organization', 'organisation', 'enterprise', 'department', 'office', 'staff', 'team', 'employee'],
      },
    ];

    for (const definition of definitions) {
      if (definition.trigger.test(requestText)) groups.push([...definition.terms]);
    }

    return groups;
  }

  private extractIntentTokens(value: string): Set<string> {
    const stop = new Set([
      'about', 'after', 'before', 'company', 'issue', 'issues', 'problem', 'problems',
      'with', 'from', 'into', 'that', 'this', 'there', 'their', 'have', 'has', 'need',
      'needs', 'want', 'wants', 'software', 'system', 'application', 'platform', 'company',
    ]);
    const aliases = new Map<string, string>([
      ['financial', 'finance'],
      ['finances', 'finance'],
      ['administrative', 'administration'],
      ['admin', 'administration'],
      ['businesses', 'business'],
      ['companies', 'business'],
      ['organisation', 'organization'],
      ['organizations', 'organization'],
      ['students', 'student'],
      ['assignments', 'assignment'],
      ['homeworks', 'homework'],
      ['submissions', 'submission'],
      ['employees', 'employee'],
      ['workers', 'workforce'],
      ['recruiting', 'recruitment'],
      ['recruiters', 'recruitment'],
      ['candidates', 'candidate'],
      ['applicants', 'applicant'],
      ['expenses', 'expense'],
      ['costs', 'cost'],
      ['records', 'record'],
      ['insights', 'insight'],
      ['breaches', 'breach'],
      ['threats', 'threat'],
      ['attacks', 'attack'],
      ['alerts', 'alert'],
      ['incidents', 'incident'],
      ['credentials', 'credential'],
      ['vulnerabilities', 'vulnerability'],
    ]);
    return new Set(
      value
        .split(' ')
        .map((token) => aliases.get(token) ?? token)
        .filter((token) => token.length >= 4 && !stop.has(token)),
    );
  }

  private normalizeIntentText(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private normalizeFinalRankingWarnings(
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    if (!ranking.selected.selectionEligible) {
      return ranking;
    }

    const verifiedDirectCount =
      ranking.selected.verifiedProblemMatchedDirectUserEvidenceCount ??
      ranking.selected.verifiedDirectUserEvidenceCount ??
      ranking.selected.verifiedIndependentEvidenceCount ??
      0;
    const verifiedSecondaryCount =
      ranking.selected.verifiedProblemMatchedSecondaryEvidenceCount ??
      ranking.selected.verifiedSecondaryEvidenceCount ??
      0;
    const verifiedFeatureRequestCount =
      ranking.selected.verifiedProblemMatchedFeatureRequestEvidenceCount ??
      ranking.selected.verifiedFeatureRequestEvidenceCount ??
      0;
    const verifiedComplaintCount =
      ranking.selected.verifiedProblemMatchedComplaintEvidenceCount ??
      ranking.selected.verifiedComplaintEvidenceCount ??
      0;
    const featureRequestOnly =
      verifiedDirectCount > 0 &&
      verifiedComplaintCount === 0 &&
      verifiedFeatureRequestCount === verifiedDirectCount;
    const verifiedEvidenceCount =
      ranking.selected.verifiedProblemMatchedEvidenceCount ??
      ranking.selected.verifiedEvidenceCount ??
      verifiedDirectCount + verifiedSecondaryCount;
    if (verifiedEvidenceCount <= 0) {
      return ranking;
    }

    const staleFallbackWarning =
      /^(?:No opportunity reached the strict minimum score|No opportunity passed the strict selection gate|The selected opportunity is supported by .*verified direct community report)/iu;
    const cleanedWarnings = ranking.qualityWarnings.filter(
      (warning) => !staleFallbackWarning.test(warning),
    );

    const preliminaryWarning =
      featureRequestOnly
        ? `The selected opportunity is supported by ${verifiedFeatureRequestCount} verified feature request(s). It is eligible for a preliminary pilot, but feature requests do not by themselves establish complaint recurrence or market-wide prevalence.`
        : verifiedDirectCount === 0 && verifiedSecondaryCount > 0
          ? `The selected opportunity is supported by ${verifiedSecondaryCount} secondary retained report(s) and no verified direct user complaint. It is eligible only for a preliminary pilot; recurrence and market-wide claims remain unproven.`
          : `The selected opportunity is supported by ${verifiedDirectCount} verified direct user report(s). It is eligible for a preliminary pilot, while recurrence and market-wide claims remain unproven.`;

    if (!cleanedWarnings.includes(preliminaryWarning)) {
      cleanedWarnings.unshift(preliminaryWarning);
    }

    return {
      ...ranking,
      qualityWarnings: cleanedWarnings,
    };
  }

  private normalizeFinalRankingEvidenceCoverage(
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const retainedEvidenceCount = Math.max(
      ranking.selected.evidenceSamples.length,
      ranking.selected.verifiedProblemMatchedEvidenceCount ??
        ranking.selected.verifiedIndependentEvidenceCount ??
        0,
    );
    const normalizedCoverage = Math.max(
      ranking.evidenceCoverage,
      retainedEvidenceCount > 0
        ? Math.min(1, retainedEvidenceCount / 3)
        : 0,
    );

    if (normalizedCoverage === ranking.evidenceCoverage) {
      return ranking;
    }

    return {
      ...ranking,
      evidenceCoverage: Number(normalizedCoverage.toFixed(4)),
    };
  }

  private resolveWinnerPrimaryDomain(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): { readonly id: string; readonly name: string } | null {
    const matchedNames = ranking.selected.matchedDomainNames ?? [];
    const rawDomainName = this.readCandidateDomainName(ranking.selected.raw);
    const candidateNames = [
      ranking.selected.primaryMatchedDomainName ?? '',
      ...matchedNames,
      rawDomainName,
    ].filter(Boolean);

    for (const candidateName of candidateNames) {
      const normalized = candidateName.trim().toLocaleLowerCase();
      const selected = context.selectedDomains.find(
        (domain) => domain.name.trim().toLocaleLowerCase() === normalized,
      );
      if (selected) {
        return { id: selected.id, name: selected.name };
      }
    }

    const current = context.selectedDomains.find(
      (domain) => domain.id === context.domainId,
    );
    return current
      ? { id: current.id, name: current.name }
      : context.domainId && context.domainName
        ? { id: context.domainId, name: context.domainName }
        : null;
  }

  private synchronizeSelectedOpportunityEvidence(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): IdeaGenerationContext['domainEvidence'] {
    const selectedDomainName = (
      ranking.selected.primaryMatchedDomainName ??
      ranking.selected.matchedDomainNames?.[0] ??
      this.readCandidateDomainName(ranking.selected.raw) ??
      context.domainName ??
      ''
    ).trim();
    const selectedSamples = ranking.selected.evidenceSamples
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);

    if (!selectedDomainName || selectedSamples.length === 0) {
      return context.domainEvidence;
    }

    const provenanceByText = new Map(
      (ranking.selected.independentEvidence ?? []).map((item) => [
        this.normalizeEvidenceKey(item.text),
        item,
      ]),
    );

    return context.domainEvidence.map((entry) => {
      if (
        entry.domainName.trim().toLowerCase() !==
        selectedDomainName.toLowerCase()
      ) {
        return entry;
      }

      const existingPosts = Array.isArray(entry.samplePosts)
        ? entry.samplePosts.filter(
            (item): item is Prisma.JsonObject =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];
      const existingComments = Array.isArray(entry.sampleComments)
        ? entry.sampleComments.filter(
            (item): item is Prisma.JsonObject =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];
      const existingKeys = new Set(
        [...existingPosts, ...existingComments]
          .map((item) =>
            typeof item.text === 'string'
              ? this.normalizeEvidenceKey(item.text)
              : '',
          )
          .filter(Boolean),
      );

      const synchronizedPosts: Prisma.JsonObject[] = [];
      const synchronizedComments: Prisma.JsonObject[] = [];

      selectedSamples.forEach((sample, index) => {
        const key = this.normalizeEvidenceKey(sample);
        if (existingKeys.has(key)) return;

        const provenance = provenanceByText.get(key);
        if (provenance?.commentExternalId) {
          synchronizedComments.push({
            id: provenance.commentExternalId,
            postId: provenance.postExternalId || provenance.threadExternalId,
            text: sample,
            sentiment: 'NEUTRAL',
          });
          return;
        }

        synchronizedPosts.push({
          id: provenance?.postExternalId || `selected-opportunity:evidence:${index + 1}`,
          text: sample,
          sentiment: 'NEUTRAL',
        });
      });

      const mergedPosts = [...synchronizedPosts, ...existingPosts].slice(0, 8);
      const mergedComments = [
        ...synchronizedComments,
        ...existingComments,
      ].slice(0, 8);
      const totalPostsAnalyzed = Math.max(
        entry.totalPostsAnalyzed,
        mergedPosts.length,
      );
      const totalCommentsAnalyzed = Math.max(
        entry.totalCommentsAnalyzed,
        mergedComments.length,
      );

      return {
        ...entry,
        samplePosts: mergedPosts,
        sampleComments: mergedComments,
        evidenceAvailable: mergedPosts.length + mergedComments.length > 0,
        totalPostsAnalyzed,
        totalCommentsAnalyzed,
        totalTextsAnalyzed: totalPostsAnalyzed + totalCommentsAnalyzed,
      };
    });
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