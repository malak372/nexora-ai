import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_COMPOSITE_REQUEST_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_COMPOSITE_TOTAL_TIMEOUT_MS,
} from '../../constants/community-ai-analysis.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { CommunityAiAnalysisService } from '../../services/community-ai-analysis.service';
import type {
  CommunityAiAnalysis,
  CommunityAiDomainHypothesis,
  CommunityAiOpportunity,
} from '../../types/community-ai-analysis.type';
import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
} from '../../types/idea-generation-context.type';
import {
  classifyDirectCommunityEvidence,
  isStructuredOperationalProblemEvidence,
} from '../../../../nlp/common/utils/community-evidence.util';
import {
  resolvePrimaryProblemFamily,
} from '../../../../nlp/common/utils/problem-family-matching.util';
import { RequestEvidenceAlignmentUtil } from '../../utils/request-evidence-alignment.util';
import { CanonicalEvidenceVerificationUtil } from '../../utils/canonical-evidence-verification.util';
import { CanonicalEvidenceStateUtil } from '../../utils/canonical-evidence-state.util';
import { EvidenceSourceIdentityUtil } from '../../utils/evidence-source-identity.util';

/**
 * Enriches cleaned NLP output with evidence-grounded opportunities extracted
 * by an LLM. Failure is non-fatal: the original deterministic NLP output is
 * preserved so the existing ranking stage remains fully compatible.
 */
@Injectable()
export class CommunityAiAnalysisStage implements IdeaGenerationStage {
  private readonly logger = new Logger(CommunityAiAnalysisStage.name);
  readonly key = IDEA_GENERATION_STAGE_KEYS.COMMUNITY_AI_ANALYSIS;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly communityAiAnalysisService: CommunityAiAnalysisService,
  ) {}

  shouldExecute(context: IdeaGenerationContext): boolean {
    return Boolean(context.nlp);
  }

  async execute(
    context: IdeaGenerationContext,
    signal?: AbortSignal,
  ): Promise<IdeaGenerationStageExecutionResult> {
    if (!context.nlp) {
      return {
        context,
        resultPreview:
          'Community AI analysis skipped because NLP data is unavailable.',
        metadata: {
          analysisLayer: 'IDEA_OPPORTUNITY_ENRICHMENT',
          duplicatesNlpAiEnhancement: false,
          aiAnalysisApplied: false,
        },
      };
    }

    const plannedRequest = Boolean(
      context.requestDescription?.trim() && context.collectionPlan,
    );
    const requesterProblemLocked = this.hasExplicitRequesterProblem(context);
    const hasSelectedDomainEvidence =
      this.hasAnyRetainedSelectedDomainEvidence(context);
    const hasRequestAlignedEvidence = requesterProblemLocked
      ? this.hasAnyRetainedRequestAlignedEvidence(context)
      : hasSelectedDomainEvidence;
    const hasGroundedEvidenceForOnlineAi = requesterProblemLocked
      ? hasRequestAlignedEvidence
      : hasSelectedDomainEvidence;
    const retainedEvidenceCount = this.countRetainedEvidenceTexts(context);
    const rawEvidenceCandidateCount = context.rawEvidenceCorpus?.length ?? 0;
    const hasRawAiTriageCorpus = rawEvidenceCandidateCount > 0;
    const hasCompositeSynthesisCorpus =
      plannedRequest &&
      !hasGroundedEvidenceForOnlineAi &&
      (retainedEvidenceCount >= 2 || rawEvidenceCandidateCount >= 2);

    let baseAnalysis: CommunityAiAnalysis;

    /*
     * A requester description is a hypothesis, not evidence. If both retained
     * and raw external corpora are empty there is nothing legitimate for an
     * online model to synthesize, so skip the network call entirely. Targeted
     * recovery in the ranking stage remains responsible for finding evidence.
     */
    if (
      plannedRequest &&
      retainedEvidenceCount === 0 &&
      rawEvidenceCandidateCount === 0
    ) {
      baseAnalysis = this.buildFallbackAnalysis(context);
    } else {

    /*
     * Community AI is executed when there is actual retained/raw evidence. The online service
     * already launches provider-diverse attempts concurrently and falls back to
     * retained evidence when providers are unavailable or their output is not
     * grounded. This keeps the semantic layer active on every generation path
     * without letting provider failures block deterministic ranking.
     *
     * When no grounded corpus exists, keep the online window short because an
     * LLM cannot manufacture evidence; targeted recovery remains authoritative.
     */
    try {
      baseAnalysis = await this.communityAiAnalysisService.analyze(context, {
        maxAttempts: hasGroundedEvidenceForOnlineAi
          ? 3
          : hasCompositeSynthesisCorpus || hasRawAiTriageCorpus
            ? 2
            : 1,
        requestTimeoutMs: hasGroundedEvidenceForOnlineAi
          ? COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS
          : hasCompositeSynthesisCorpus || hasRawAiTriageCorpus
            ? COMMUNITY_AI_ANALYSIS_COMPOSITE_REQUEST_TIMEOUT_MS
            : 2_800,
        totalTimeoutMs: hasGroundedEvidenceForOnlineAi
          ? COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS
          : hasCompositeSynthesisCorpus || hasRawAiTriageCorpus
            ? COMMUNITY_AI_ANALYSIS_COMPOSITE_TOTAL_TIMEOUT_MS
            : 3_000,
        signal,
      });
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown Community AI failure.';
      this.logger.error(
        `Community AI analysis failed unexpectedly; deterministic NLP remains active. error=${reason}`,
      );
      const emergencyFallback = this.buildFallbackAnalysis(context);
      baseAnalysis = {
        ...emergencyFallback,
        aiAttempted: true,
        fallbackReason: `Unexpected Community AI service failure: ${reason}`,
        qualityWarnings: [
          ...emergencyFallback.qualityWarnings,
          ...(plannedRequest && !hasRequestAlignedEvidence
            ? [
                'Community AI executed as required, but the retained first-pass corpus did not contain request-aligned evidence; provider output cannot establish demand until targeted recovery contributes external evidence.',
              ]
            : []),
        ],
        attemptDiagnostics: [
          {
            attempt: 1,
            modelId: null,
            apiModelId: null,
            providerKey: null,
            status: 'EXECUTION_FAILED',
            durationMs: 0,
            reason,
          },
        ],
        attemptCount: Math.max(1, emergencyFallback.attemptCount),
        onlineAttemptCount: Math.max(1, emergencyFallback.onlineAttemptCount),
        executionFailureCount: Math.max(
          1,
          emergencyFallback.executionFailureCount,
        ),
      };
    }
    }

    const analysis = this.ensureSelectedDomainCoverage(context, baseAnalysis);

    const canonicalEvidenceLedger = this.buildCanonicalEvidenceLedger(
      context,
      analysis,
    );
    const canonicalClassifications = canonicalEvidenceLedger.map((item) => ({
      evidenceId: item.id,
      classification: item.classification,
      confidence: item.confidence,
      reason:
        item.classification === 'UNADJUDICATED'
          ? 'Online semantic adjudication did not complete for this raw evidence row; no relevance verdict was inferred deterministically.'
          : item.origin === 'COMMUNITY_AI'
          ? 'AI semantic triage accepted this evidence after deterministic verification.'
          : 'Canonical evidence ledger admitted a concrete external problem signal after deterministic verification.',
      problemFamily: item.problemFamily,
      verifiedByDeterministicGuard: item.verified,
      adjudicationStatus: item.adjudicationStatus,
      adjudicationFailureReason: item.adjudicationFailureReason,
      evidenceKind: item.evidenceKind,
    }));
    const canonicalState = CanonicalEvidenceStateUtil.compute(canonicalEvidenceLedger);
    const evidenceAlignedAnalysis =
      canonicalState.trustedCount > 0
        ? this.alignDiscoveryAnalysisToCanonicalEvidence(
            context,
            analysis,
            canonicalEvidenceLedger,
          )
        : analysis;
    const unresolvedCanonicalRows = canonicalEvidenceLedger.filter(
      (item) => item.classification === 'UNADJUDICATED',
    ).length;
    const adjudicationUnavailable =
      evidenceAlignedAnalysis.evidenceVerdictState ===
        'EVIDENCE_ADJUDICATION_UNAVAILABLE' ||
      canonicalState.state === 'EVIDENCE_ADJUDICATION_UNAVAILABLE';
    const authoritativeAnalysis: CommunityAiAnalysis =
      canonicalState.trustedCount > 0
        ? evidenceAlignedAnalysis
        : {
            ...evidenceAlignedAnalysis,
            dominantProblems: [],
            unmetNeeds: [],
            opportunities: [],
            overallConfidence: Math.min(analysis.overallConfidence, 15),
            aiSucceeded: false,
            fallbackUsed: true,
            fallbackReason:
              analysis.fallbackReason ??
              (adjudicationUnavailable
                ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE: raw external evidence exists but online semantic adjudication did not complete.'
                : 'No canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence survived deterministic verification.'),
            selectedProblemFamily: null,
            selectedProblemFamilyEvidenceIds: [],
            selectedProblemFamilyTrustedEvidenceCount: 0,
            selectedProblemFamilyDistinctSourceCount: 0,
            selectedProblemFamilySelectionSource:
              analysis.aiProposedProblemFamily?.trim() ||
              analysis.selectedProblemFamilySelectionSource ===
                'AI_SELECTED_PENDING_VERIFICATION'
                ? 'AI_PROPOSAL_REJECTED'
                : null,
            qualityWarnings: [
              ...analysis.qualityWarnings,
              adjudicationUnavailable
                ? 'Evidence adjudication is unavailable for a material portion of the raw corpus; UNADJUDICATED material was preserved and was not mislabelled as unrelated or promoted into trusted evidence.'
                : unresolvedCanonicalRows > 0
                  ? `Canonical evidence state is NO_VALID_EVIDENCE_FOUND for the adjudicated corpus; ${unresolvedCanonicalRows} high-coverage tail row(s) remain UNADJUDICATED and are excluded from both positive and negative evidence claims.`
                  : 'Canonical evidence state is NO_VALID_EVIDENCE_FOUND; semantic adjudication completed but no DIRECT_PROBLEM or SUPPORTING_SIGNAL row passed canonical verification.',
            ],
            evidenceVerdictState: adjudicationUnavailable
              ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
              : 'NO_VALID_EVIDENCE_FOUND',
          };
    const canonicalFamilyLock = this.buildCanonicalProblemFamilyLock(
      authoritativeAnalysis,
      canonicalEvidenceLedger,
      context.requestMode,
    );
    const secondaryOnlyFamily = canonicalFamilyLock
      ? canonicalEvidenceLedger
          .filter((item) => canonicalFamilyLock.evidenceIds.includes(item.id))
          .every((item) =>
            item.evidenceKind === 'ACADEMIC_TECHNICAL_SIGNAL' ||
            item.evidenceKind === 'NEWS_REPORT' ||
            item.evidenceKind === 'MARKET_REPORT',
          )
      : false;
    const canonicalOpportunity = canonicalFamilyLock
      ? authoritativeAnalysis.opportunities.find((opportunity) =>
          this.problemFamilyMatchesSelectedFamily(
            canonicalFamilyLock.label,
            opportunity.title,
            opportunity.problem,
          ),
        ) ?? authoritativeAnalysis.opportunities[0] ?? null
      : null;
    const canonicalOpportunities = canonicalFamilyLock && canonicalOpportunity
      ? [
          {
            ...canonicalOpportunity,
            title: canonicalFamilyLock.label,
          },
        ]
      : [];
    const canonicalDistinctSourceCount = canonicalFamilyLock
      ? EvidenceSourceIdentityUtil.count(
          canonicalEvidenceLedger.filter((item) =>
            canonicalFamilyLock.evidenceIds.includes(item.id),
          ),
        )
      : 0;
    const canonicalTruthWarnings = this.buildCanonicalTruthWarnings(
      authoritativeAnalysis.qualityWarnings,
      canonicalState,
      Boolean(canonicalFamilyLock),
    );
    const synchronizedAnalysis: CommunityAiAnalysis = {
      ...authoritativeAnalysis,
      summary: canonicalFamilyLock
        ? `Canonical evidence verification locked the discovery problem family to "${canonicalFamilyLock.label}" using ${canonicalFamilyLock.evidenceIds.length} verified family-matched signal(s) across ${canonicalDistinctSourceCount} distinct source(s). This identity is immutable downstream.`
        : canonicalState.trustedCount > 0
          ? `Canonical evidence verification retained ${canonicalState.trustedCount} trusted problem signal(s), but no single problem-family identity survived the immutable family-lock check. Trusted rows remain available for diagnostics/recovery and no downstream stage may describe a family as locked.`
          : authoritativeAnalysis.summary,
      dominantProblems: canonicalOpportunity ? [canonicalOpportunity.problem] : [],
      unmetNeeds: canonicalOpportunity ? [canonicalOpportunity.unmetNeed] : [],
      opportunities: canonicalOpportunities,
      selectedProblemFamily: canonicalFamilyLock?.label ?? null,
      selectedProblemFamilyEvidenceIds: canonicalFamilyLock?.evidenceIds ?? [],
      selectedProblemFamilyTrustedEvidenceCount: canonicalFamilyLock?.evidenceIds.length ?? 0,
      selectedProblemFamilyDistinctSourceCount: canonicalDistinctSourceCount,
      canonicalProblemFamilyId: canonicalFamilyLock?.id ?? null,
      canonicalProblemFamilyLabel: canonicalFamilyLock?.label ?? null,
      canonicalProblemFamilyEvidenceIds: canonicalFamilyLock?.evidenceIds ?? [],
      evidenceClassifications: canonicalClassifications,
      fallbackReason: this.buildCanonicalTruthFallbackReason(
        authoritativeAnalysis.fallbackReason,
        canonicalState,
        Boolean(canonicalFamilyLock),
      ),
      qualityWarnings: secondaryOnlyFamily
        ? [
            ...canonicalTruthWarnings,
            'The canonical family is supported only by secondary technical/report evidence. It validates a problem signal, not recurring community demand or prevalence.',
          ]
        : canonicalTruthWarnings,
    };

    const enrichedNlp: IdeaGenerationNlpContext = {
      ...context.nlp,
      recurringProblems: canonicalState.trustedCount === 0
        ? this.toJsonArray([])
        : plannedRequest
          ? this.toJsonArray(
            synchronizedAnalysis.opportunities.map((opportunity) => ({
              domainName: opportunity.domainName,
              title: opportunity.title,
              problem: opportunity.problem,
              frequency: opportunity.frequency,
              severity: opportunity.severity,
              evidenceSamples: [...opportunity.evidenceSamples],
              source: 'COMMUNITY_LLM_ANALYSIS',
              aiConfidence: opportunity.confidence,
            })),
          )
        : this.mergeJsonArrays(
            context.nlp.recurringProblems,
            synchronizedAnalysis.opportunities.map((opportunity) => ({
              domainName: opportunity.domainName,
              title: opportunity.title,
              problem: opportunity.problem,
              frequency: opportunity.frequency,
              severity: opportunity.severity,
              evidenceSamples: [...opportunity.evidenceSamples],
              source: 'COMMUNITY_LLM_ANALYSIS',
              aiConfidence: opportunity.confidence,
            })),
          ),
      extractedNeeds: canonicalState.trustedCount === 0
        ? this.toJsonArray([])
        : plannedRequest
          ? this.toJsonArray(
            synchronizedAnalysis.opportunities.map((opportunity) => ({
              domainName: opportunity.domainName,
              title: opportunity.unmetNeed,
              need: opportunity.unmetNeed,
              problem: opportunity.problem,
              solutionArea: opportunity.solutionArea,
              frequency: opportunity.frequency,
              severity: opportunity.severity,
              evidenceSamples: [...opportunity.evidenceSamples],
              source: 'COMMUNITY_LLM_ANALYSIS',
            })),
          )
        : this.mergeJsonArrays(
            context.nlp.extractedNeeds,
            synchronizedAnalysis.opportunities.map((opportunity) => ({
              domainName: opportunity.domainName,
              title: opportunity.unmetNeed,
              need: opportunity.unmetNeed,
              problem: opportunity.problem,
              solutionArea: opportunity.solutionArea,
              frequency: opportunity.frequency,
              severity: opportunity.severity,
              evidenceSamples: [...opportunity.evidenceSamples],
              source: 'COMMUNITY_LLM_ANALYSIS',
            })),
          ),
      featureRequests: plannedRequest
        ? this.toJsonArray([])
        : context.nlp.featureRequests,
      /*
       * The AI portfolio is authoritative. Deterministic NLP no longer creates
       * opportunities, so replacing the array avoids duplicate ranking work
       * and guarantees that every ranked opportunity came from the AI layer.
       */
      opportunities: this.toNlpOpportunities(synchronizedAnalysis.opportunities),
      insights: this.mergeJsonArrays(context.nlp.insights, [
        {
          type: 'COMMUNITY_AI_ANALYSIS',
          summary: synchronizedAnalysis.summary,
          dominantProblems: [...synchronizedAnalysis.dominantProblems],
          unmetNeeds: [...synchronizedAnalysis.unmetNeeds],
          overallConfidence: authoritativeAnalysis.overallConfidence,
          qualityWarnings: [...synchronizedAnalysis.qualityWarnings],
          modelId: authoritativeAnalysis.modelId,
          apiModelId: authoritativeAnalysis.apiModelId,
          attemptCount: authoritativeAnalysis.attemptCount,
          aiAttempted: authoritativeAnalysis.aiAttempted,
          triageAiSucceeded: authoritativeAnalysis.triageAiSucceeded ?? false,
          synthesisAiSucceeded: authoritativeAnalysis.synthesisAiSucceeded ?? authoritativeAnalysis.aiSucceeded,
          aiSucceeded: authoritativeAnalysis.aiSucceeded,
          fallbackUsed: authoritativeAnalysis.fallbackUsed,
          onlineAttemptCount: authoritativeAnalysis.onlineAttemptCount,
          executionFailureCount: authoritativeAnalysis.executionFailureCount,
          validationRejectedCount: authoritativeAnalysis.validationRejectedCount,
          fallbackReason: authoritativeAnalysis.fallbackReason,
          attemptDiagnostics: authoritativeAnalysis.attemptDiagnostics.map((item) => ({ ...item })),
          unvalidatedDomainHypotheses: authoritativeAnalysis.unvalidatedDomainHypotheses.map(
            (item) => ({ ...item, risks: [...item.risks] }),
          ),
          evidenceClassifications: canonicalClassifications.map((item) => ({ ...item })),
          evidenceVerdictState:
            synchronizedAnalysis.evidenceVerdictState ??
            (canonicalState.trustedCount > 0
              ? 'VALID_EVIDENCE_FOUND'
              : adjudicationUnavailable
                ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
                : 'NO_VALID_EVIDENCE_FOUND'),
          rawEvidenceCandidateCount,
          /*
           * Keep the two evidence funnels explicit in the run snapshot. Raw
           * collector candidates may be triaged by Community AI even when the
           * stricter trusted-NLP preprocessing corpus is empty. These counters
           * make that distinction observable instead of presenting it as a
           * contradictory "0 analyzed vs N classified" result.
           */
          triageEligibleEvidenceCount: rawEvidenceCandidateCount,
          nlpProcessedEvidenceCount: context.nlp.totalTextsAnalyzed ?? 0,
          trustedNlpEvidenceCount:
            canonicalClassifications.filter(
              (item) => item.verifiedByDeterministicGuard &&
                (item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL'),
            ).length,
          /*
           * Zero trusted evidence has two explicit states. A completed negative
           * adjudication is NO_VALID_EVIDENCE_FOUND; provider/transport failure
           * is EVIDENCE_ADJUDICATION_UNAVAILABLE. Persist contextual and
           * unadjudicated pools separately so UI/QA never confuses "AI said no"
           * with "AI never returned a verdict".
           */
          contextualEvidenceCandidateCount:
            canonicalClassifications.filter(
              (item) =>
                item.classification === 'CONTEXT_ONLY' ||
                item.classification === 'ANALOGOUS_WORKFLOW_SIGNAL',
            ).length,
          reviewedEvidenceCandidateCount: canonicalClassifications.length,
          aiProposedProblemFamily:
            authoritativeAnalysis.aiProposedProblemFamily ?? null,
          aiProposedProblemFamilyEvidenceIds:
            [...(authoritativeAnalysis.aiProposedProblemFamilyEvidenceIds ?? [])],
          selectedProblemFamilySelectionSource:
            synchronizedAnalysis.selectedProblemFamilySelectionSource ?? null,
          selectedProblemFamily:
            synchronizedAnalysis.selectedProblemFamily ?? null,
          selectedProblemFamilyTrustedEvidenceCount:
            synchronizedAnalysis.selectedProblemFamilyTrustedEvidenceCount ?? 0,
          selectedProblemFamilyDistinctSourceCount:
            synchronizedAnalysis.selectedProblemFamilyDistinctSourceCount ?? 0,
          selectedProblemFamilyEvidenceIds:
            [...(synchronizedAnalysis.selectedProblemFamilyEvidenceIds ?? [])],
          canonicalProblemFamilyId: synchronizedAnalysis.canonicalProblemFamilyId ?? null,
          canonicalProblemFamilyLabel: synchronizedAnalysis.canonicalProblemFamilyLabel ?? null,
          canonicalProblemFamilyEvidenceIds: [...(synchronizedAnalysis.canonicalProblemFamilyEvidenceIds ?? [])],
          evidencePipelineSemantics:
            'Raw collector candidates are semantically triaged before final trusted evidence admission. DIRECT_PROBLEM + SUPPORTING_SIGNAL are trusted. ANALOGOUS_WORKFLOW_SIGNAL is useful adjacent-workflow context but never validates requester demand. UNADJUDICATED means online semantic adjudication did not complete; it is neither related nor unrelated evidence.',
          directEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.verifiedByDeterministicGuard && item.classification === 'DIRECT_PROBLEM',
            ).length,
          supportingEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.verifiedByDeterministicGuard && item.classification === 'SUPPORTING_SIGNAL',
            ).length,
          analogousWorkflowSignalClassificationCount:
            canonicalClassifications.filter(
              (item) => item.classification === 'ANALOGOUS_WORKFLOW_SIGNAL',
            ).length,
          contextOnlyEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.classification === 'CONTEXT_ONLY',
            ).length,
          unrelatedEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.classification === 'UNRELATED',
            ).length,
          unadjudicatedEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.classification === 'UNADJUDICATED',
            ).length,
          evidenceAdjudicationUnavailable:
            canonicalState.state === 'EVIDENCE_ADJUDICATION_UNAVAILABLE',
        },
      ]),
      aiUsed: context.nlp.aiUsed || authoritativeAnalysis.aiAttempted || authoritativeAnalysis.aiSucceeded,
      confidence: this.mergeConfidence(
        context.nlp.confidence,
        authoritativeAnalysis.overallConfidence / 100,
      ),
    };

    return {
      context: {
        ...context,
        nlp: enrichedNlp,
        canonicalEvidenceLedger,
        evidenceState: canonicalState.state,
        communityAiAnalysis: synchronizedAnalysis,
      },
      resultPreview: (() => {
        const groundedCount = synchronizedAnalysis.opportunities.filter(
          (opportunity) => opportunity.evidenceSamples.length > 0,
        ).length;
        const hypothesisCount = authoritativeAnalysis.unvalidatedDomainHypotheses.length;

        if (groundedCount > 0 && hypothesisCount === 0) {
          return `Community AI analysis extracted ${groundedCount} evidence-grounded opportunity candidate(s).`;
        }

        if (groundedCount > 0) {
          return `Generated ${groundedCount} grounded opportunity candidate(s) and kept ${hypothesisCount} unsupported domain hypothesis candidate(s) separate from evidence ranking.`;
        }

        return adjudicationUnavailable
          ? `Raw evidence was collected but semantic adjudication is unavailable; ${hypothesisCount} unvalidated domain hypothesis candidate(s) were kept separate without mislabelling the raw corpus as unrelated.`
          : `No grounded Community AI opportunity survived validation; ${hypothesisCount} unvalidated domain hypothesis candidate(s) were kept separate for last-resort use.`;
      })(),
      metadata: {
        analysisLayer: 'IDEA_OPPORTUNITY_ENRICHMENT',
        duplicatesNlpAiEnhancement: false,
        aiAnalysisApplied: authoritativeAnalysis.aiAttempted || authoritativeAnalysis.aiSucceeded,
        opportunityCount: synchronizedAnalysis.opportunities.length,
        overallConfidence: authoritativeAnalysis.overallConfidence,
        modelId: authoritativeAnalysis.modelId,
        apiModelId: authoritativeAnalysis.apiModelId,
        attemptCount: authoritativeAnalysis.attemptCount,
        aiAttempted: authoritativeAnalysis.aiAttempted,
        triageAiSucceeded: authoritativeAnalysis.triageAiSucceeded ?? false,
        synthesisAiSucceeded: authoritativeAnalysis.synthesisAiSucceeded ?? authoritativeAnalysis.aiSucceeded,
        aiSucceeded: authoritativeAnalysis.aiSucceeded,
        fallbackUsed: authoritativeAnalysis.fallbackUsed,
        onlineAttemptCount: authoritativeAnalysis.onlineAttemptCount,
        executionFailureCount: authoritativeAnalysis.executionFailureCount,
        validationRejectedCount: authoritativeAnalysis.validationRejectedCount,
        fallbackReason: authoritativeAnalysis.fallbackReason,
        attemptDiagnostics: authoritativeAnalysis.attemptDiagnostics,
        qualityWarnings: authoritativeAnalysis.qualityWarnings,
        representedDomains: [...new Set(synchronizedAnalysis.opportunities.map((item) => item.domainName))],
        unvalidatedDomainHypothesisCount: authoritativeAnalysis.unvalidatedDomainHypotheses.length,
        canonicalTrustedEvidenceCount: canonicalEvidenceLedger.filter(
          (item) => item.verified &&
            (item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL'),
        ).length,
        contextualEvidenceCandidateCount: canonicalEvidenceLedger.filter(
          (item) =>
            item.classification === 'CONTEXT_ONLY' ||
            item.classification === 'ANALOGOUS_WORKFLOW_SIGNAL',
        ).length,
        reviewedEvidenceCandidateCount: canonicalEvidenceLedger.length,
        evidenceVerdictState:
          synchronizedAnalysis.evidenceVerdictState ??
          (canonicalState.trustedCount > 0
            ? 'VALID_EVIDENCE_FOUND'
            : adjudicationUnavailable
              ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
              : 'NO_VALID_EVIDENCE_FOUND'),
      },
    };
  }

  /**
   * Converts the AI opportunities to Prisma's read-side JSON representation.
   *
   * `IdeaGenerationNlpContext.opportunities` is `Prisma.JsonValue`, while
   * `Prisma.InputJsonObject` belongs to Prisma's write-side JSON API and is
   * intentionally not assignable to `JsonValue`. Building a `JsonArray` here
   * keeps the generation context type-safe without weakening its contract.
   */
  private alignDiscoveryAnalysisToCanonicalEvidence(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
    ledger: IdeaGenerationContext['canonicalEvidenceLedger'],
  ): CommunityAiAnalysis {
    if (this.hasExplicitRequesterProblem(context)) {
      return this.attachSelectedProblemFamilyMetrics(context, analysis, ledger);
    }

    const trusted = [...ledger].filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    if (trusted.length === 0) {
      const aiProposalExists = Boolean(
        analysis.aiProposedProblemFamily?.trim() ||
          (analysis.aiProposedProblemFamilyEvidenceIds?.length ?? 0) > 0,
      );
      return {
        ...analysis,
        selectedProblemFamily: null,
        selectedProblemFamilySelectionSource: aiProposalExists
          ? 'AI_PROPOSAL_REJECTED'
          : null,
        selectedProblemFamilyTrustedEvidenceCount: 0,
        selectedProblemFamilyDistinctSourceCount: 0,
        selectedProblemFamilyEvidenceIds: [],
      };
    }

    /*
     * The semantic-triage clustering step already compared complete verified
     * families by evidence count, direct/supporting class, source diversity,
     * and confidence.  Do not throw that decision away here by selecting the
     * single highest-confidence ledger row.  Doing so previously changed a
     * clustered winner such as one restaurant family into a different family
     * merely because one unrelated row had a slightly higher confidence.
     */
    const clusteredWinner = analysis.opportunities[0] ?? null;
    const clusteredFamily = clusteredWinner?.title?.trim() ?? '';
    const familyTrusted = clusteredFamily
      ? trusted.filter((item) =>
          this.discoveryProblemFamilyEntails(
            clusteredFamily,
            item.problemFamily,
          ) ||
          this.problemFamilyMatchesSelectedFamily(
            clusteredFamily,
            item.problemFamily,
            item.text,
          ),
        )
      : [];
    const aiProposedIds = new Set(
      (analysis.aiProposedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const aiProposedFamilyRaw = analysis.aiProposedProblemFamily?.trim() ?? '';
    const aiProposedFamily = aiProposedFamilyRaw
      ? `${aiProposedFamilyRaw.charAt(0).toUpperCase()}${aiProposedFamilyRaw.slice(1)}`
      : '';
    const aiSelectedTrusted = aiProposedIds.size > 0
      ? trusted.filter((item) => aiProposedIds.has(item.id))
      : [];

    /*
     * The provider chooses a family from the complete corpus, so verification
     * must evaluate its surviving selected evidence as one semantic group.
     * Requiring every individual row to repeat every family token fragmented a
     * coherent problem across labels such as one raw review sentence and one
     * normalized provider family. Canonical trust still remains item-level;
     * only the family-name entailment check is group-level.
     */
    const aiSelectionSurvived = Boolean(
      aiProposedFamily &&
      aiSelectedTrusted.length > 0 &&
      this.problemFamilyMatchesSelectedFamilyGroup(
        aiProposedFamily,
        aiSelectedTrusted,
      ),
    );
    const lockedClusteredWinner =
      clusteredWinner &&
      ((aiSelectionSurvived &&
        this.problemFamilyMatchesSelectedFamilyGroup(
          aiProposedFamily,
          familyTrusted.length > 0 ? familyTrusted : aiSelectedTrusted,
        )) ||
        (!aiSelectionSurvived && familyTrusted.length > 0))
        ? clusteredWinner
        : null;
    const selectedFamilyItems = aiSelectionSurvived
      ? aiSelectedTrusted
      : familyTrusted.length > 0
        ? familyTrusted
        : this.selectStrongestTrustedFamilyItems(trusted);

    const lead = selectedFamilyItems[0];
    if (!lead) return analysis;

    const domain =
      context.selectedDomains.find((candidate) =>
        lead.matchedDomainIds.includes(candidate.id),
      ) ??
      context.selectedDomains.find(
        (candidate) => candidate.id === lead.discoveryDomainId,
      ) ??
      context.selectedDomains[0];
    const domainName = domain?.name ?? context.domainName ?? 'Selected domain';
    const evidenceNativeFallbackFamily = this.deriveProblemBearingFamilyFromEvidence(
      lead.text,
      domainName,
    );
    const ledgerFamily = this.isUsableEvidenceFamilyLabel(
      lead.problemFamily,
      lead.text,
    )
      ? lead.problemFamily?.trim() ?? ''
      : '';
    const family = aiSelectionSurvived
      ? aiProposedFamily
      : familyTrusted.length > 0
        ? clusteredFamily
        : evidenceNativeFallbackFamily || ledgerFamily;
    if (!family) {
      const rejectedAiProposalExists = Boolean(
        aiProposedFamily || aiProposedIds.size > 0,
      );
      return {
        ...analysis,
        selectedProblemFamily: null,
        selectedProblemFamilySelectionSource: rejectedAiProposalExists
          ? 'AI_PROPOSAL_REJECTED'
          : null,
        selectedProblemFamilyTrustedEvidenceCount: 0,
        selectedProblemFamilyDistinctSourceCount: 0,
        selectedProblemFamilyEvidenceIds: [],
        qualityWarnings: Array.from(new Set([
          ...analysis.qualityWarnings,
          'Trusted evidence was retained globally, but no concrete pain-bearing problem family could be derived from it without inventing a placeholder or copying a source title. The evidence remains in the canonical ledger for recovery/diagnostics only.',
        ])),
      };
    }
    const selectionSource = aiSelectionSurvived
      ? 'AI_SELECTED_VERIFIED' as const
      : familyTrusted.length > 0
        ? 'AI_CLUSTER_VERIFIED' as const
        : 'DETERMINISTIC_VERIFIED_FALLBACK' as const;

    const orderedFamilyItems = [...selectedFamilyItems].sort((left, right) => {
      const leftDirect = left.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      const rightDirect = right.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      return rightDirect - leftDirect || right.confidence - left.confidence;
    });
    const evidenceSamples = orderedFamilyItems
      .slice(0, 8)
      .map((item) => item.text);
    const distinctSourceCount =
      EvidenceSourceIdentityUtil.count(orderedFamilyItems);
    const averageConfidence =
      orderedFamilyItems.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(1, orderedFamilyItems.length);
    const compactEvidence = lead.text.replace(/\s+/gu, ' ').trim().slice(0, 520);
    const problem = lockedClusteredWinner?.problem?.trim()
      ? lockedClusteredWinner.problem
      : compactEvidence
        ? `A retained external ${lead.sourceType.toLocaleLowerCase()} documents this verified problem signal: ${compactEvidence}`
        : `A retained external evidence item documents a verified ${family} problem signal.`;
    const unmetNeed = lockedClusteredWinner?.unmetNeed?.trim()
      ? lockedClusteredWinner.unmetNeed
      : `A focused software workflow that addresses ${family} while preserving human review and validating how broadly the problem occurs.`;

    const opportunity: CommunityAiOpportunity = {
      ...(lockedClusteredWinner ?? {
        domainName,
        title: family,
        problem,
        unmetNeed,
        solutionArea: `Evidence-grounded workflow for ${family}`,
        affectedUsers: [
          'Users or operators represented by the retained external evidence',
        ],
        evidenceSamples,
        frequency: orderedFamilyItems.length,
        severity: 'MEDIUM' as const,
        confidence: Math.max(35, Math.min(90, Math.round(averageConfidence))),
        problemImportance: Math.max(
          40,
          Math.min(85, Math.round(averageConfidence)),
        ),
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: 20,
        groundingScore: Math.max(
          40,
          Math.min(100, Math.round(averageConfidence)),
        ),
        technicalFeasibility: 65,
        marketPotential: 40,
        innovationPotential: 50,
        risks: [],
      }),
      domainName,
      title: family,
      problem,
      unmetNeed,
      solutionArea:
        lockedClusteredWinner?.solutionArea?.trim() ||
        `Evidence-grounded workflow for ${family}`,
      evidenceSamples,
      frequency: orderedFamilyItems.length,
      confidence: Math.max(
        35,
        Math.min(
          90,
          Math.max(
            lockedClusteredWinner?.confidence ?? 0,
            Math.round(averageConfidence),
          ),
        ),
      ),
      groundingScore: Math.max(
        50,
        Math.min(
          100,
          Math.max(
            lockedClusteredWinner?.groundingScore ?? 0,
            Math.round(averageConfidence),
          ),
        ),
      ),
      risks: [
        `The selected problem family is grounded by ${orderedFamilyItems.length} retained verified evidence item(s) across ${distinctSourceCount} distinct source(s); broader validation is still required before prevalence claims are made.`,
      ],
    };

    return {
      ...analysis,
      summary:
        `Canonical evidence verification retained ${trusted.length} trusted problem signal(s) globally. ` +
        `${selectionSource === 'AI_SELECTED_VERIFIED'
          ? 'The full-corpus Community AI proposal survived deterministic evidence verification'
          : selectionSource === 'AI_CLUSTER_VERIFIED'
            ? 'The AI-derived verified evidence cluster survived deterministic verification'
            : 'The AI proposal did not retain verified evidence, so the strongest deterministic verified fallback was used'}; ` +
        `the discovery opportunity is locked to "${family}" with ${orderedFamilyItems.length} trusted family-matched signal(s) across ${distinctSourceCount} distinct source(s).`,
      dominantProblems: [problem],
      unmetNeeds: [unmetNeed],
      opportunities: [opportunity],
      overallConfidence: Math.max(
        analysis.overallConfidence,
        Math.min(80, Math.round(averageConfidence * 0.75)),
      ),
      selectedProblemFamily: family,
      selectedProblemFamilySelectionSource: selectionSource,
      selectedProblemFamilyTrustedEvidenceCount: orderedFamilyItems.length,
      selectedProblemFamilyDistinctSourceCount: distinctSourceCount,
      selectedProblemFamilyEvidenceIds: orderedFamilyItems.map((item) => item.id),
      fallbackUsed: analysis.fallbackUsed || analysis.opportunities.length === 0,
      fallbackReason:
        analysis.opportunities.length === 0
          ? 'Online opportunity synthesis did not return a usable object; the canonical verified evidence ledger produced the discovery opportunity without changing the evidence family.'
          : analysis.fallbackReason,
      qualityWarnings: [
        ...analysis.qualityWarnings.filter(
          (warning) =>
            !/no persisted nlp evidence samples are available for grounding/iu.test(
              warning,
            ),
        ),
        selectionSource === 'AI_SELECTED_VERIFIED'
          ? 'The full-corpus Community AI selected this family and the same selected evidence ids both survived deterministic verification and semantically entail the family label; downstream stages must preserve that canonical identity.'
          : 'The original AI family label was not preserved unless surviving trusted evidence entailed that exact family. The canonical discovery family therefore reflects the strongest evidence-native verified family and downstream stages must preserve that identity.',
      ],
    };
  }

  private attachSelectedProblemFamilyMetrics(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
    ledger: IdeaGenerationContext['canonicalEvidenceLedger'],
  ): CommunityAiAnalysis {
    const trusted = ledger.filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    if (trusted.length === 0) return analysis;

    const aiProposedFamily = analysis.aiProposedProblemFamily?.trim() ?? '';
    const aiProposedIds = new Set(
      (analysis.aiProposedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const aiProposedItems = aiProposedIds.size > 0
      ? trusted.filter((item) => aiProposedIds.has(item.id))
      : [];
    const aiProposalSurvived = Boolean(
      aiProposedFamily &&
        aiProposedItems.length > 0 &&
        aiProposedItems.length === aiProposedIds.size &&
        this.problemFamilyMatchesSelectedFamilyGroup(
          aiProposedFamily,
          aiProposedItems,
        ),
    );

    const opportunityFamily = analysis.opportunities[0]?.title?.trim() ?? '';
    const previouslySelectedFamily = analysis.selectedProblemFamily?.trim() ?? '';
    let selectedFamily = aiProposalSurvived
      ? aiProposedFamily
      : previouslySelectedFamily || opportunityFamily;
    let familyItems = selectedFamily
      ? trusted.filter((item) =>
          this.problemFamilyMatchesSelectedFamily(
            selectedFamily,
            item.problemFamily,
            item.text,
          ),
        )
      : [];

    if (aiProposalSurvived) {
      familyItems = aiProposedItems;
    }

    if (familyItems.length === 0) {
      const strongestFamilyItems = this.selectStrongestTrustedFamilyItems(trusted);
      const leadFamily = strongestFamilyItems[0]?.problemFamily?.trim() ?? '';
      if (!leadFamily) {
        return {
          ...analysis,
          selectedProblemFamily: null,
          selectedProblemFamilySelectionSource:
            aiProposedFamily || aiProposedIds.size > 0
              ? 'AI_PROPOSAL_REJECTED'
              : null,
          selectedProblemFamilyTrustedEvidenceCount: 0,
          selectedProblemFamilyDistinctSourceCount: 0,
          selectedProblemFamilyEvidenceIds: [],
        };
      }
      selectedFamily = leadFamily;
      familyItems = strongestFamilyItems;
    }

    const orderedFamilyItems = [...familyItems].sort((left, right) => {
      const leftDirect = left.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      const rightDirect = right.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      return rightDirect - leftDirect || right.confidence - left.confidence;
    });
    const distinctSourceCount = EvidenceSourceIdentityUtil.count(orderedFamilyItems);
    const averageConfidence =
      orderedFamilyItems.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(1, orderedFamilyItems.length);
    const evidenceSamples = orderedFamilyItems
      .map((item) => item.text.trim())
      .filter(Boolean)
      .slice(0, 8);

    const selectedOpportunity =
      analysis.opportunities.find((opportunity) =>
        this.problemFamilyMatchesSelectedFamily(
          selectedFamily,
          opportunity.title,
          opportunity.problem,
        ),
      ) ?? analysis.opportunities[0] ?? null;
    const explicitProblem =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
        ? context.collectionPlan.requestIntent.explicitProblem?.trim() ||
          context.requestDescription?.trim() ||
          ''
        : context.requestDescription?.trim() || '';
    const lead = orderedFamilyItems[0];
    const domainName =
      selectedOpportunity?.domainName?.trim() ||
      lead?.matchedDomainNames?.[0]?.trim() ||
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'Selected domain';
    const requesterScopedProblem = explicitProblem
      ? `Within the requester-defined workflow, the strongest retained evidence supports the "${selectedFamily}" problem facet. Canonical requester scope: ${explicitProblem}`
      : selectedFamily;
    const requesterScopedNeed =
      `Prioritize product design around the evidence-leading requester facet "${selectedFamily}" while preserving the broader canonical request only as secondary scope until its remaining facets are independently validated.`;

    const canonicalOpportunity: CommunityAiOpportunity = selectedOpportunity
      ? {
          ...selectedOpportunity,
          domainName,
          title: selectedFamily,
          problem: requesterScopedProblem,
          unmetNeed: selectedOpportunity.unmetNeed?.trim() || requesterScopedNeed,
          solutionArea: `Evidence-prioritized requester workflow: ${selectedFamily}`,
          evidenceSamples,
          frequency: orderedFamilyItems.length,
          confidence: Math.max(
            selectedOpportunity.confidence,
            Math.max(35, Math.min(90, Math.round(averageConfidence))),
          ),
          risks: [
            `The selected problem family is grounded by ${orderedFamilyItems.length} retained verified evidence item(s) across ${distinctSourceCount} distinct source(s); broader validation is still required before prevalence claims are made.`,
          ],
        }
      : {
          domainName,
          title: selectedFamily,
          problem: requesterScopedProblem,
          unmetNeed: requesterScopedNeed,
          solutionArea: `Evidence-prioritized requester workflow: ${selectedFamily}`,
          affectedUsers: ['Requester-defined target users represented by the retained workflow'],
          evidenceSamples,
          frequency: orderedFamilyItems.length,
          severity: 'MEDIUM',
          confidence: Math.max(35, Math.min(90, Math.round(averageConfidence))),
          problemImportance: Math.max(40, Math.min(85, Math.round(averageConfidence))),
          localEvidenceAvailable: false,
          localEvidenceSamples: [],
          localRelevance: 20,
          groundingScore: Math.max(50, Math.min(100, Math.round(averageConfidence))),
          technicalFeasibility: 65,
          marketPotential: 40,
          innovationPotential: 50,
          risks: [
            `The selected problem family is grounded by ${orderedFamilyItems.length} retained verified evidence item(s) across ${distinctSourceCount} distinct source(s); broader validation is still required before prevalence claims are made.`,
          ],
        };

    return {
      ...analysis,
      opportunities: [
        canonicalOpportunity,
        ...analysis.opportunities.filter(
          (opportunity) => opportunity !== selectedOpportunity,
        ),
      ],
      selectedProblemFamily: selectedFamily,
      selectedProblemFamilySelectionSource: aiProposalSurvived
        ? 'AI_SELECTED_VERIFIED'
        : 'AI_CLUSTER_VERIFIED',
      selectedProblemFamilyTrustedEvidenceCount: orderedFamilyItems.length,
      selectedProblemFamilyDistinctSourceCount: distinctSourceCount,
      selectedProblemFamilyEvidenceIds: orderedFamilyItems.map((item) => item.id),
    };
  }

  private normalizeAiProblemFamily(value: string | null | undefined): string {
    return (value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[_-]+/gu, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private discoveryProblemFamilyEntails(
    selectedFamily: string,
    evidenceFamily: string | null,
  ): boolean {
    const selected = this.normalizeAiProblemFamily(selectedFamily);
    const evidence = this.normalizeAiProblemFamily(evidenceFamily);
    return Boolean(selected && evidence && selected === evidence);
  }

  private problemFamilyMatchesSelectedFamilyGroup(
    selectedFamily: string,
    items: readonly IdeaGenerationContext['canonicalEvidenceLedger'][number][],
  ): boolean {
    const selected = this.normalizeAiProblemFamily(selectedFamily);
    if (!selected || items.length === 0) return false;
    return items.every(
      (item) =>
        item.verified &&
        item.familyBasis === 'OBSERVED_PROBLEM' &&
        this.normalizeAiProblemFamily(item.problemFamily) === selected,
    );
  }

  private problemFamilyMatchesSelectedFamily(
    selectedFamily: string,
    evidenceFamily: string | null,
    _evidenceText: string,
  ): boolean {
    return this.discoveryProblemFamilyEntails(selectedFamily, evidenceFamily);
  }

  private problemFamilyIdentityAgreesForCanonicalLock(
    selectedFamily: string,
    item: IdeaGenerationContext['canonicalEvidenceLedger'][number],
  ): boolean {
    return (
      item.verified &&
      item.familyBasis === 'OBSERVED_PROBLEM' &&
      this.discoveryProblemFamilyEntails(selectedFamily, item.problemFamily)
    );
  }

  private selectStrongestTrustedFamilyItems(
    trusted: readonly IdeaGenerationContext['canonicalEvidenceLedger'][number][],
  ): IdeaGenerationContext['canonicalEvidenceLedger'] {
    const candidates = trusted
      .map((item) => item.problemFamily?.trim() ?? '')
      .filter(Boolean);
    if (candidates.length === 0) {
      return [...trusted]
        .sort((left, right) => {
          const leftDirect = left.classification === 'DIRECT_PROBLEM' ? 1 : 0;
          const rightDirect = right.classification === 'DIRECT_PROBLEM' ? 1 : 0;
          return rightDirect - leftDirect || right.confidence - left.confidence;
        })
        .slice(0, 1);
    }

    let best: IdeaGenerationContext['canonicalEvidenceLedger'] = [];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const family of [...new Set(candidates)]) {
      const items = trusted.filter((item) =>
        this.problemFamilyMatchesSelectedFamily(
          family,
          item.problemFamily,
          item.text,
        ),
      );
      if (items.length === 0) continue;

      const directCount = items.filter(
        (item) => item.classification === 'DIRECT_PROBLEM',
      ).length;
      const sourceCount = EvidenceSourceIdentityUtil.count(items);
      const averageConfidence =
        items.reduce((sum, item) => sum + item.confidence, 0) /
        Math.max(1, items.length);
      const score =
        directCount * 100 +
        sourceCount * 35 +
        items.length * 20 +
        averageConfidence;

      if (score > bestScore) {
        bestScore = score;
        best = items;
      }
    }

    return [...best].sort((left, right) => {
      const leftDirect = left.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      const rightDirect = right.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      return rightDirect - leftDirect || right.confidence - left.confidence;
    });
  }


  private buildCanonicalProblemFamilyLock(
    analysis: CommunityAiAnalysis,
    ledger: IdeaGenerationContext['canonicalEvidenceLedger'],
    requestMode: IdeaGenerationContext['requestMode'],
  ): { readonly id: string; readonly label: string; readonly evidenceIds: string[] } | null {
    void requestMode;
    const label = analysis.selectedProblemFamily?.replace(/\s+/gu, ' ').trim() ?? '';
    const requestedIds = [...new Set(
      (analysis.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    )];
    if (!label || requestedIds.length === 0) return null;

    const byId = new Map(ledger.map((item) => [item.id, item] as const));
    const verified = requestedIds
      .map((id) => byId.get(id))
      .filter((item): item is IdeaGenerationContext['canonicalEvidenceLedger'][number] => Boolean(item))
      .filter((item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL'),
      );
    if (verified.length !== requestedIds.length) return null;

    /*
     * Semantic family ownership belongs to the accepted Community-AI verdict.
     * Deterministic code does not re-read evidence text with token/stem/synonym
     * rules. A canonical lock exists only when every AI-selected row is trusted,
     * explicitly marked as OBSERVED_PROBLEM, and carries the same normalized
     * neutral family label selected by the model.
     */
    if (!this.problemFamilyMatchesSelectedFamilyGroup(label, verified)) {
      return null;
    }

    const evidenceIds = requestedIds;
    const normalizedLabel = label
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const id = createHash('sha256')
      .update(`${normalizedLabel}|${[...evidenceIds].sort().join('|')}`)
      .digest('hex')
      .slice(0, 24);
    return { id, label, evidenceIds };
  }


  private buildCanonicalEvidenceLedger(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): IdeaGenerationContext['canonicalEvidenceLedger'] {
    const rawById = new Map(
      (context.rawEvidenceCorpus ?? []).map((item) => [item.id, item] as const),
    );
    const ledger = new Map<string, IdeaGenerationContext['canonicalEvidenceLedger'][number]>();

    for (const classification of analysis.evidenceClassifications ?? []) {
      const raw = rawById.get(classification.evidenceId);
      if (!raw) continue;
      const verified = CanonicalEvidenceVerificationUtil.verify({
        raw,
        proposal: {
          classification: classification.classification,
          confidence: classification.confidence,
          problemFamily: classification.problemFamily,
          verifiedByDeterministicGuard: classification.verifiedByDeterministicGuard,
          evidenceNature: classification.evidenceNature,
          domainAlignment: classification.domainAlignment,
          problemAlignment: classification.problemAlignment,
          familyBasis: classification.familyBasis,
          observedProblem: classification.observedProblem,
          causalExplanation: classification.causalExplanation,
          matchedDomainNames: classification.matchedDomainNames,
          adjudicationStatus: classification.adjudicationStatus,
          adjudicationFailureReason: classification.adjudicationFailureReason,
          origin: 'COMMUNITY_AI',
        },
        requestMode: context.requestMode,
        problemSpec: context.canonicalProblemSpec,
        selectedDomains: context.selectedDomains,
      });
      ledger.set(raw.id, verified);
    }

    /*
     * Canonical completeness invariant: every raw item gets exactly one row in
     * the canonical ledger, even when the online triage timed out, returned a
     * partial batch, or omitted an evidence id.  Missing classifications are
     * conservatively represented as untrusted fallback rows and then pass through the
     * exact same structural verifier as AI classifications.  Raw evidence is therefore
     * never lost, while only verified DIRECT/SUPPORTING rows become trusted.
     */
    for (const raw of context.rawEvidenceCorpus ?? []) {
      if (ledger.has(raw.id)) continue;
      const proposal = CanonicalEvidenceVerificationUtil.buildDeterministicFallbackProposal({
        raw,
        requestMode: context.requestMode,
        origin: 'DETERMINISTIC_FALLBACK',
      });
      ledger.set(
        raw.id,
        CanonicalEvidenceVerificationUtil.verify({
          raw,
          proposal,
          requestMode: context.requestMode,
          problemSpec: context.canonicalProblemSpec,
          selectedDomains: context.selectedDomains,
        }),
      );
    }

    return [...ledger.values()];
  }

  private ensureSelectedDomainCoverage(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    const represented = new Set(
      analysis.opportunities.map((item) =>
        item.domainName.trim().toLocaleLowerCase(),
      ),
    );
    const existingHypotheses = new Map(
      analysis.unvalidatedDomainHypotheses.map((item) => [
        item.domainName.trim().toLocaleLowerCase(),
        item,
      ]),
    );
    const missingDirectEvidenceDomains: string[] = [];
    const hypotheses: CommunityAiDomainHypothesis[] = [
      ...analysis.unvalidatedDomainHypotheses,
    ];
    const canonicalClassifications = analysis.evidenceClassifications ?? [];
    const canonicalTrustedDomainNames = new Set(
      canonicalClassifications
        .filter(
          (item) =>
            item.adjudicationStatus === 'ADJUDICATED' &&
            item.verifiedByDeterministicGuard === true &&
            (item.classification === 'DIRECT_PROBLEM' ||
              item.classification === 'SUPPORTING_SIGNAL'),
        )
        .flatMap((item) => item.matchedDomainNames ?? [])
        .map((name) => name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const canonicalDirectDomainNames = new Set(
      canonicalClassifications
        .filter(
          (item) =>
            item.adjudicationStatus === 'ADJUDICATED' &&
            item.verifiedByDeterministicGuard === true &&
            item.classification === 'DIRECT_PROBLEM',
        )
        .flatMap((item) => item.matchedDomainNames ?? [])
        .map((name) => name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );

    for (const domain of context.selectedDomains) {
      const key = domain.name.trim().toLocaleLowerCase();
      const hasCanonicalTrustedEvidence = canonicalTrustedDomainNames.has(key);
      const hasCanonicalDirectEvidence = canonicalDirectDomainNames.has(key);
      const hasRetainedEvidence =
        hasCanonicalTrustedEvidence ||
        this.hasRetainedDomainEvidence(context, domain.id);
      const hasRetainedDirectEvidence =
        hasCanonicalDirectEvidence ||
        this.hasRetainedDirectDomainEvidence(context, domain.id);

      if (!hasRetainedDirectEvidence) {
        missingDirectEvidenceDomains.push(domain.name);
      }

      /*
       * A selected domain needs a validation-first hypothesis only when no
       * canonical DIRECT/SUPPORTING row and no legacy grounded retained sample
       * represents it. A domain can be absent from opportunities while still
       * being directly represented by the canonical evidence ledger.
       */
      if (represented.has(key) || hasRetainedEvidence) {
        continue;
      }

      if (!existingHypotheses.has(key)) {
        hypotheses.push({
          domainName: domain.name,
          title: `${domain.name} validation-first workflow opportunity`,
          problem: `A concrete community problem for ${domain.name} was not retained or did not survive semantic evidence validation.`,
          unmetNeed: `A validation workflow that discovers and tests the highest-value ${domain.name} problem before implementation.`,
          solutionArea: 'Problem discovery, validation, and configurable pilot workflow',
          confidence: 15,
          risks: [
            'This is an unvalidated domain hypothesis and must not be presented as observed community demand.',
          ],
        });
      }
    }

    const qualityWarnings = analysis.qualityWarnings.filter(
      (warning) =>
        !this.isCanonicalMissingEvidenceWarning(warning) &&
        !this.isProviderDomainCoverageWarning(warning, context),
    );

    return {
      ...analysis,
      unvalidatedDomainHypotheses: hypotheses,
      qualityWarnings: [
        ...qualityWarnings,
        ...(missingDirectEvidenceDomains.length > 0 &&
        context.domainResolution?.source === 'USER_SELECTED'
          ? [
              analysis.evidenceVerdictState ===
              'EVIDENCE_ADJUDICATION_UNAVAILABLE'
                ? `No adjudicated direct evidence is currently available for selected domain(s): ${missingDirectEvidenceDomains.join(', ')}; collected raw rows may still be pending semantic verdict.`
                : `No direct retained evidence was available for selected domain(s): ${missingDirectEvidenceDomains.join(', ')}.`,
            ]
          : []),
      ],
    };
  }

  private countRetainedEvidenceTexts(context: IdeaGenerationContext): number {
    const profileCount = context.domainEvidence.reduce(
      (sum, profile) => sum + Math.max(0, profile.totalTextsAnalyzed ?? 0),
      0,
    );
    const nlpCount = Math.max(0, context.nlp?.totalTextsAnalyzed ?? 0);

    if (profileCount > 0 || nlpCount > 0) {
      return Math.max(profileCount, nlpCount);
    }

    const samples = [
      ...context.domainEvidence.flatMap((profile) => [
        ...(Array.isArray(profile.samplePosts) ? profile.samplePosts : []),
        ...(Array.isArray(profile.sampleComments) ? profile.sampleComments : []),
      ]),
      ...(Array.isArray(context.nlp?.samplePosts) ? context.nlp.samplePosts : []),
      ...(Array.isArray(context.nlp?.sampleComments) ? context.nlp.sampleComments : []),
    ];

    return samples.filter(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof (entry as Prisma.JsonObject)['text'] === 'string' &&
        ((entry as Prisma.JsonObject)['text'] as string).trim().length > 0,
    ).length;
  }

  private hasAnyRetainedRequestAlignedEvidence(
    context: IdeaGenerationContext,
  ): boolean {
    const description = context.requestDescription?.trim();
    if (!description) return true;

    const samples = [
      ...context.domainEvidence.flatMap((profile) => [
        ...(Array.isArray(profile.samplePosts) ? profile.samplePosts : []),
        ...(Array.isArray(profile.sampleComments) ? profile.sampleComments : []),
      ]),
      ...(Array.isArray(context.nlp?.samplePosts) ? context.nlp.samplePosts : []),
      ...(Array.isArray(context.nlp?.sampleComments) ? context.nlp.sampleComments : []),
    ];

    const evidenceTexts = samples
      .filter(
        (entry): entry is Prisma.JsonObject =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry),
      )
      .map((entry) =>
        typeof entry['text'] === 'string' ? entry['text'] : '',
      )
      .filter((text) => text.trim().length > 0);

    return RequestEvidenceAlignmentUtil.isCompositeAligned({
      requestDescription: description,
      evidenceTexts,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
  }

  private hasAnyRetainedSelectedDomainEvidence(
    context: IdeaGenerationContext,
  ): boolean {
    const domainIds = context.selectedDomains.length
      ? context.selectedDomains.map((domain) => domain.id)
      : [context.domainId];

    if (
      domainIds.some((domainId) => this.hasRetainedDomainEvidence(context, domainId))
    ) {
      return true;
    }

    if (context.domainEvidence.length > 0) {
      return false;
    }

    const nlpPosts = Array.isArray(context.nlp?.samplePosts)
      ? context.nlp.samplePosts.length
      : 0;
    const nlpComments = Array.isArray(context.nlp?.sampleComments)
      ? context.nlp.sampleComments.length
      : 0;
    const nlpTexts = context.nlp?.totalTextsAnalyzed ?? 0;

    return nlpTexts > 0 || nlpPosts + nlpComments > 0;
  }

  private hasRetainedDirectDomainEvidence(
    context: IdeaGenerationContext,
    domainId: string,
  ): boolean {
    const profile = context.domainEvidence.find(
      (item) => item.domainId === domainId,
    );
    if (!profile) return false;

    const directSample = (
      entry: unknown,
      sourceType: 'POST' | 'COMMENT',
    ): boolean => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
      }
      const rawText =
        typeof (entry as Record<string, unknown>).text === 'string'
          ? ((entry as Record<string, unknown>).text as string)
          : '';
      const body = rawText
        .replace(/^.*?\bCommunity comment:\s*/isu, '')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!body) return false;

      if (isStructuredOperationalProblemEvidence(rawText, sourceType)) {
        return true;
      }

      const kind = classifyDirectCommunityEvidence(body, sourceType);
      if (
        kind === 'USER_COMPLAINT' ||
        kind === 'FEATURE_REQUEST' ||
        kind === 'OBSERVED_UNMET_NEED'
      ) {
        if (sourceType === 'COMMENT') return true;
        return /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b/iu.test(
          body,
        );
      }

      const explicitRequestSignal =
        /\b(?:i wish|i hope|please add|please support|would be helpful|need an? option|need support for|feature request)\b/iu.test(
          body,
        ) &&
        /\b(?:add|support|enable|login|sign[- ]?in|authentication|2fa|two[- ]factor|google|apple|email|option|access)\b/iu.test(
          body,
        );
      return sourceType === 'COMMENT' && explicitRequestSignal;
    };

    return (
      (Array.isArray(profile.sampleComments) &&
        profile.sampleComments.some((entry) => directSample(entry, 'COMMENT'))) ||
      (Array.isArray(profile.samplePosts) &&
        profile.samplePosts.some((entry) => directSample(entry, 'POST')))
    );
  }

  private hasRetainedDomainEvidence(
    context: IdeaGenerationContext,
    domainId: string,
  ): boolean {
    const profile = context.domainEvidence.find(
      (item) => item.domainId === domainId,
    );

    if (!profile) {
      return false;
    }

    const postSamples = Array.isArray(profile.samplePosts)
      ? profile.samplePosts
      : [];
    const commentSamples = Array.isArray(profile.sampleComments)
      ? profile.sampleComments
      : [];

    return (
      postSamples.some((entry) => this.isGroundedRetainedSample(entry, 'POST')) ||
      commentSamples.some((entry) =>
        this.isGroundedRetainedSample(entry, 'COMMENT'),
      )
    );
  }

  private isGroundedRetainedSample(
    entry: unknown,
    sourceType: 'POST' | 'COMMENT',
  ): boolean {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }

    const record = entry as Record<string, unknown>;
    const rawText = typeof record.text === 'string' ? record.text : '';
    const body = rawText
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!body) return false;

    const kind = classifyDirectCommunityEvidence(body, sourceType);
    const userAuthoredPostSignal =
      sourceType === 'POST' &&
      /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b/iu.test(body);
    const technicalTicketSignal =
      sourceType === 'POST' &&
      /\b(?:the problem is|problem details|what i tried|i am trying|i['’]?m trying|i get (?:the following )?error|exception|traceback|stack trace|error message|fails? when|stuck at)\b/iu.test(
        body,
      );
    if (
      (kind === 'USER_COMPLAINT' ||
        kind === 'FEATURE_REQUEST' ||
        kind === 'OBSERVED_UNMET_NEED') &&
      (sourceType === 'COMMENT' ||
        userAuthoredPostSignal ||
        technicalTicketSignal ||
        isStructuredOperationalProblemEvidence(rawText, sourceType))
    ) {
      return true;
    }

    if (isStructuredOperationalProblemEvidence(rawText, sourceType)) {
      return true;
    }

    const family = resolvePrimaryProblemFamily(body);
    if (!family || family.key.startsWith('lexical:')) {
      return false;
    }

    const explicitProblemSignal =
      /\b(?:error|failed|failure|failing|cannot|can['’]?t|unable|blocked|missing|lost|delayed|stuck|outage|downtime|unavailable|legal risk|compliance risk|privacy risk|security risk|reverted|incorrect|wrong|stale|not updating|hallucination|shortage|overloaded)\b/iu.test(
        body,
      );

    return (
      explicitProblemSignal &&
      (sourceType === 'COMMENT' || userAuthoredPostSignal || technicalTicketSignal)
    );
  }

  private isUsableEvidenceFamilyLabel(
    family: string | null | undefined,
    evidenceText: string,
  ): boolean {
    const value = family?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!value) return false;
    if (/\b(?:verified workflow problem|operational friction requiring validation|validation[- ]first workflow opportunity)\b/iu.test(value)) {
      return false;
    }
    const painCue = /\b(?:problem|problems|failure|failures|failed|delay|delays|delayed|difficulty|difficult|challenge|challenges|barrier|barriers|risk|risks|breach|outage|downtime|fatigue|error|errors|loss|losses|missing|unavailable|unreliable|reliability|bottleneck|bottlenecks|rework|waste|wasted|fragmented|siloed|unauthorized|inconsistent|unable|cannot|can['’]?t|stuck)\b/iu;
    if (!painCue.test(value)) return false;
    return this.problemFamilyMatchesSelectedFamily(value, family ?? null, evidenceText);
  }

  /**
   * Produces a pain-bearing discovery label only from the retained evidence
   * body. It deliberately refuses the old "Verified Workflow Problem"
   * placeholder and avoids turning an academic/source title into a problem
   * unless the text itself contains an explicit failure, barrier, risk, delay,
   * loss, reliability, or other operational-friction cue.
   */
  private deriveProblemBearingFamilyFromEvidence(
    value: string,
    domainName: string,
  ): string | null {
    const text = value
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!text) return null;

    const strongPainCue = /\b(?:problem|problems|failure|failures|failed|delay|delays|delayed|difficulty|difficult|challenge|challenges|barrier|barriers|risk|risks|breach|outage|downtime|fatigue|error|errors|loss|losses|missing|unavailable|unreliable|reliability|bottleneck|bottlenecks|rework|waste|wasted|fragmented|siloed|unauthorized|inconsistent|unable|cannot|can['’]?t|stuck)\b/iu;
    const solutionOrPaperTitle = /\b(?:automating|automation|framework|architecture|integrating|integration|approach|methodology|model for|system for|platform for|using (?:ai|artificial intelligence)|detection)\b/iu.test(text);
    if (solutionOrPaperTitle && !strongPainCue.test(text)) return null;

    const knownFamily = resolvePrimaryProblemFamily(text);
    if (knownFamily && !knownFamily.key.startsWith('lexical:') && knownFamily.key !== 'generic-friction') {
      return knownFamily.label;
    }

    if (/\balert fatigue\b/iu.test(text)) {
      return 'Alert Fatigue and Incident-Response Friction';
    }
    if (/\bdata breach\b[^.!?]{0,180}\bincident handling\b|\bincident handling\b[^.!?]{0,180}\bdata breach\b/iu.test(text)) {
      return 'Data-Breach Incident Handling and Response Friction';
    }
    if (/\breliability problem\b|\breliability (?:failure|failures|risk|risks|issues?)\b/iu.test(text)) {
      return `${domainName} Reliability and Operational Friction`;
    }

    const painCue = /\b(?:problem|problems|failure|failures|failing|failed|delay|delays|delayed|difficult|difficulty|challenge|challenges|barrier|barriers|risk|risks|breach|outage|downtime|fatigue|error|errors|loss|losses|missing|unavailable|unreliable|reliability|bottleneck|bottlenecks|rework|waste|wasted|cost pressure|fragmented|siloed|unauthorized|inconsistent|unable|cannot|can['’]?t|stuck)\b/iu;
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((sentence) => sentence.replace(/\s+/gu, ' ').trim())
      .filter((sentence) => sentence.length >= 12 && sentence.length <= 420);
    const painSentence = sentences.find((sentence) => painCue.test(sentence));
    if (!painSentence) return null;

    const cleaned = painSentence
      .replace(/^(?:abstract|purpose|background|objective|objectives|study|paper|article|research)\s*[:.-]?\s*/iu, '')
      .replace(/^(?:how|why)\s+/iu, '')
      .replace(/\b(?:this|the) (?:study|paper|article|research)\b/giu, ' ')
      .replace(/[^\p{L}\p{N}\s&'’-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!cleaned || !painCue.test(cleaned)) return null;

    const stop = new Set([
      'a', 'an', 'the', 'of', 'for', 'to', 'and', 'or', 'with', 'in', 'on',
      'from', 'that', 'this', 'these', 'those', 'is', 'are', 'was', 'were',
      'be', 'been', 'being', 'can', 'could', 'may', 'might', 'often',
    ]);
    const words = cleaned
      .split(/\s+/u)
      .filter((word) => !stop.has(word.toLocaleLowerCase()))
      .slice(0, 10);
    if (words.length < 2) return null;

    const label = words
      .map((word) =>
        word.length <= 3 && /^[A-Z0-9]+$/u.test(word)
          ? word
          : `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`,
      )
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();

    if (label.length < 8) return null;
    if (label.length <= 120) return label;

    const prefix = label.slice(0, 121);
    const wordBoundary = prefix.lastIndexOf(' ');
    return (wordBoundary > 0 ? prefix.slice(0, wordBoundary) : label)
      .replace(/[\s,;:.-]+$/gu, '')
      .trim() || null;
  }

  private isCanonicalMissingEvidenceWarning(warning: string): boolean {
    return /\bno\s+(?:direct\s+)?retained\s+evidence\s+was\s+available\s+for\s+selected\s+domain\(s\)/iu.test(
      warning,
    );
  }

  private isProviderDomainCoverageWarning(
    warning: string,
    context: IdeaGenerationContext,
  ): boolean {
    const normalized = warning
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const describesMissingEvidence =
      /(?:lack|lacked|lacks|missing|without|unavailable|no)\b.*\bevidence\b/u.test(
        normalized,
      ) ||
      /\bevidence\b.*\b(?:lack|lacked|lacks|missing|unavailable)\b/u.test(
        normalized,
      );

    if (!describesMissingEvidence) {
      return false;
    }

    const selectedDomainMentioned = context.selectedDomains.some((domain) =>
      normalized.includes(
        domain.name
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      ),
    );

    return selectedDomainMentioned || normalized.includes('selected domain');
  }

  private toNlpOpportunities(
    opportunities: readonly CommunityAiOpportunity[],
  ): Prisma.JsonArray {
    return opportunities.map((opportunity) =>
      this.toNlpOpportunity(opportunity),
    );
  }

  private toNlpOpportunity(
    opportunity: CommunityAiOpportunity,
  ): Prisma.JsonObject {
    return {
      domainName: opportunity.domainName,
      title: opportunity.title,
      problem: opportunity.problem,
      need: opportunity.unmetNeed,
      solutionArea: opportunity.solutionArea,
      affectedUsers: [...opportunity.affectedUsers],
      frequency: opportunity.frequency,
      severity: opportunity.severity,
      evidenceSamples: [...opportunity.evidenceSamples],
      confidence: opportunity.confidence,
      problemImportance: opportunity.problemImportance,
      localRelevance: opportunity.localRelevance,
      technicalFeasibility: opportunity.technicalFeasibility,
      marketPotential: opportunity.marketPotential,
      innovationPotential: opportunity.innovationPotential,
      risks: [...opportunity.risks],
      source: 'COMMUNITY_LLM_ANALYSIS',
    };
  }

  /**
   * Builds a low-confidence, clearly labelled fallback when the enrichment
   * provider is unavailable or a selected domain has no collected rows.
   * Evidence text is reused verbatim when available; no fake quote is created.
   */
  private buildFallbackAnalysis(
    context: IdeaGenerationContext,
  ): CommunityAiAnalysis {
    const domains = context.selectedDomains.length
      ? context.selectedDomains
      : [
          {
            id: context.domainId,
            name: context.domainName ?? 'Selected domain',
            keywords: context.keywords,
          },
        ];
    const hypotheses: CommunityAiDomainHypothesis[] = domains
      .filter((domain) => !this.hasRetainedDomainEvidence(context, domain.id))
      .map((domain) => ({
        domainName: domain.name,
        title: `${domain.name} validation-first workflow opportunity`,
        problem: `A concrete community problem for ${domain.name} was not retained within the bounded collection window.`,
        unmetNeed: `A validation workflow that discovers and tests the highest-value ${domain.name} problem before implementation.`,
        solutionArea: 'Problem discovery, validation, and configurable pilot workflow',
        confidence: 15,
        risks: [
          'No retained community evidence grounds this hypothesis; it must not be presented as observed demand.',
        ],
      }));

    return {
      summary:
        'No retained text was available for Community AI enrichment; unvalidated domain hypotheses were kept separate from evidence-backed opportunities.',
      dominantProblems: [],
      unmetNeeds: [],
      opportunities: [],
      overallConfidence: 10,
      qualityWarnings: [
        'No retained community text was available for evidence-grounded Community AI analysis.',
      ],
      modelId: null,
      apiModelId: null,
      attemptCount: 0,
      aiAttempted: false,
      aiSucceeded: false,
      fallbackUsed: true,
      onlineAttemptCount: 0,
      executionFailureCount: 0,
      validationRejectedCount: 0,
      fallbackReason: 'No retained NLP text was available.',
      attemptDiagnostics: [],
      unvalidatedDomainHypotheses: hypotheses,
    };
  }

  /**
   * Converts retained evidence into a concise, concrete problem statement.
   *
   * The fallback must preserve the actual technical or operational friction
   * instead of replacing it with a generic "described by the sample" sentence.
   */
  private deriveProblemFromEvidence(
    evidence: string,
    domainName: string,
  ): string {
    const compact = evidence.replace(/\s+/gu, ' ').trim();
    const commentBody = compact.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim();
    const normalized = commentBody || compact;
    const semantic = normalized.toLocaleLowerCase();

    if (
      /\b(?:404|not found|missing url|incorrect url|broken route|broken link|routing|redirect|deep[- ]link|destination page)\b/iu.test(
        semantic,
      )
    ) {
      return 'A retained technical issue documents a navigation or routing failure in which a user action reaches a missing or incorrect destination endpoint instead of completing the intended workflow.';
    }

    if (
      /\b(?:legal researcher|legal research|law database|law databases|attorney|documentation)\b/iu.test(
        semantic,
      ) &&
      /\b(?:afford|expensive|price|pricing|licensing fee|1500|facts|factual|guardrail|looping|documentation)\b/iu.test(
        semantic,
      )
    ) {
      return 'An individual legal researcher reports that professional legal-research tools are unaffordable, documentation workload is difficult to manage, and general AI assistance can introduce factual errors or unstable guardrail behavior.';
    }

    const explicitProblem = normalized.match(
      /(?:my problem is|the problem is|problem[:\s]+)([^.!?]{30,360})/iu,
    );
    if (explicitProblem?.[1]) {
      return this.ensureSentence(
        explicitProblem[1]
          .replace(/^(?:that|with)\s+/iu, '')
          .trim(),
      );
    }

    const difficulty = normalized.match(
      /((?:finding|extracting|connecting|integrating|visualizing|mapping|using|debugging|validating)[^.!?]{25,360})/iu,
    );
    if (difficulty?.[1]) {
      return this.ensureSentence(difficulty[1].trim());
    }

    const firstSentence =
      normalized
        .split(/(?<=[.!?])\s+/u)
        .find((item) => item.trim().length >= 35)
        ?.trim() ?? normalized.slice(0, 320).trim();

    return this.ensureSentence(
      firstSentence ||
        `A retained ${domainName} report describes unresolved workflow friction`,
    );
  }

  private buildEvidenceOpportunityTitle(
    problem: string,
    domainName: string,
  ): string {
    const normalized = problem.toLowerCase();

    if (
      /(?:404|not found|missing url|incorrect url|navigation|routing|redirect|destination endpoint)/u.test(
        normalized,
      )
    ) {
      return 'Navigation and Routing Endpoint Failures';
    }
    if (
      /(?:legal researcher|legal research|legal-research tools|documentation workload)/u.test(
        normalized,
      ) &&
      /(?:unaffordable|factual errors|guardrail|documentation)/u.test(normalized)
    ) {
      return 'Legal Research Documentation Cost and AI Reliability Barriers';
    }
    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation)/u.test(
        normalized,
      )
    ) {
      return 'Payment Reconciliation and Duplicate Charge Failures';
    }
    if (/\brefund\b/u.test(normalized)) {
      return 'Refund Processing and Recovery Failures';
    }
    if (
      /(?:international card|foreign card|international number|foreign number|traveling from abroad|travelling from abroad|traveler|traveller)/u.test(
        normalized,
      ) &&
      /(?:otp|verification|card|payment|could not use|cannot use|can t use|not accept)/u.test(
        normalized,
      )
    ) {
      return 'International Card and OTP Access Barriers for Travelers';
    }
    if (/b-?spline|piecewise polynomial|spline coefficient/u.test(normalized)) {
      return 'Reliable B-Spline Coefficient Extraction and Validation';
    }
    if (/recommendation|recommender/u.test(normalized)) {
      return 'Recommendation Workflow Accuracy and Validation';
    }
    if (/connect|integration|api/u.test(normalized)) {
      return `${domainName} Integration Reliability`;
    }

    const words = problem
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 8);

    return words.length >= 3
      ? words.map((word) => this.capitalizeWord(word)).join(' ')
      : `${domainName} Evidence-Grounded Workflow Improvement`;
  }

  private deriveSolutionArea(problem: string, domainName: string): string {
    const normalized = problem.toLowerCase();

    if (/b-?spline|piecewise polynomial|coefficient/u.test(normalized)) {
      return 'Statistical model coefficient extraction, verification, and visualization';
    }
    if (/recommendation|recommender/u.test(normalized)) {
      return 'Recommendation quality diagnostics and explainable validation';
    }
    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation)/u.test(
        normalized,
      )
    ) {
      return 'Payment Reconciliation and Duplicate Charge Recovery';
    }
    if (
      /\brefund\b/u.test(normalized) &&
      /(?:missing|failed|failure|pending|delayed|not received|never received|error|issue|problem)/u.test(
        normalized,
      )
    ) {
      return 'Refund Status and Recovery';
    }
    if (
      /(?:payment|checkout|card|bank|billing)/u.test(normalized) &&
      /(?:error|fail(?:s|ed|ure|ing)?|declin(?:e|ed)|reject(?:ed|ion)?|blocked|not accepted|not processed|not working|cannot|can t|unable)/u.test(
        normalized,
      )
    ) {
      return 'Payment Error Diagnosis and Recovery';
    }
    if (
      /(?:international card|foreign card|international number|foreign number|traveling from abroad|travelling from abroad)/u.test(
        normalized,
      ) &&
      /(?:otp|verification|card|payment)/u.test(normalized)
    ) {
      return 'Cross-Border Payment and Verification Recovery';
    }
    if (/connect|integration|api/u.test(normalized)) {
      return 'Integration diagnostics and guided configuration validation';
    }

    return `${domainName} workflow diagnostics and guided decision support`;
  }

  private deriveAffectedUsers(
    problem: string,
    domainName: string,
  ): string[] {
    const normalized = problem.toLowerCase();

    if (/\br\b|b-?spline|polynomial|statistical/u.test(normalized)) {
      return ['Data analysts', 'Statistical computing researchers', 'Software developers'];
    }
    if (/recommendation|recommender/u.test(normalized)) {
      return ['Recommendation-system developers', 'Data analysts', 'Product teams'];
    }

    return [`${domainName} practitioners`, 'Software developers', 'Operational analysts'];
  }

  private ensureSentence(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return normalized;

    const capitalized =
      normalized.charAt(0).toUpperCase() + normalized.slice(1);

    return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
  }

  private capitalizeWord(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private extractFirstEvidence(
    value: unknown,
    sourceType: 'POST' | 'COMMENT',
  ): string | null {
    const candidates: string[] = [];

    const visit = (entry: unknown): void => {
      if (typeof entry === 'string') {
        const normalized = entry.replace(/\s+/gu, ' ').trim();
        if (normalized.length >= 8) candidates.push(normalized.slice(0, 450));
        return;
      }
      if (Array.isArray(entry)) {
        for (const item of entry) visit(item);
        return;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        for (const key of ['text', 'content', 'body', 'sample', 'samples']) {
          if (key in record) visit(record[key]);
        }
      }
    };

    visit(value);

    return (
      candidates
        .filter((candidate) =>
          this.isUsableFallbackEvidence(candidate, sourceType),
        )
        .sort(
          (first, second) =>
            this.scoreFallbackEvidence(second, sourceType) -
            this.scoreFallbackEvidence(first, sourceType),
        )[0] ?? null
    );
  }

  /**
   * Deterministic fallback may only treat a retained text as a community
   * problem when it contains observable user pain or a concrete request.
   * Publisher titles, reviews, tutorials, calls to action, and store links are
   * context only and cannot independently ground an opportunity.
   */
  private isUsableFallbackEvidence(
    value: string,
    sourceType: 'POST' | 'COMMENT',
  ): boolean {
    const body =
      value.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim() ?? value;
    const kind = classifyDirectCommunityEvidence(body, sourceType);
    return kind === 'USER_COMPLAINT' ||
      kind === 'FEATURE_REQUEST' ||
      kind === 'OBSERVED_UNMET_NEED';
  }

  private scoreFallbackEvidence(
    value: string,
    sourceType: 'POST' | 'COMMENT',
  ): number {
    const normalized = value.toLowerCase();
    let score = sourceType === 'COMMENT' ? 30 : 0;
    if (/\b(?:cannot|can'?t|unable|failed|broken|bug|error|blocked|missing)\b/iu.test(normalized)) score += 30;
    if (/\b(?:security|privacy|billing|charged|unexpected (?:cost|bill)|cost)\b/iu.test(normalized)) score += 25;
    if (/\b(?:need|should|please add|feature request|wish|is it possible|can i|could i)\b/iu.test(normalized)) score += 15;
    if (/\b(?:i|we|my|our)\b/iu.test(normalized)) score += 10;
    if (/https?:\/\/|\b(?:check out|download|app review|subscribe|tutorial)\b/iu.test(normalized)) score -= 50;
    return score;
  }


  private buildCanonicalTruthFallbackReason(
    current: string | null | undefined,
    snapshot: ReturnType<typeof CanonicalEvidenceStateUtil.compute>,
    hasCanonicalFamilyLock: boolean,
  ): string | null {
    if (snapshot.trustedCount === 0) {
      return current?.trim() || null;
    }

    if (hasCanonicalFamilyLock) {
      return 'Community AI synthesis did not return an accepted grounded opportunity, but deterministic canonical verification retained trusted evidence and established a canonical problem-family lock for downstream ranking.';
    }

    return 'Community AI synthesis did not return an accepted grounded opportunity. Deterministic canonical verification retained trusted supporting evidence, but no canonical problem-family lock was established.';
  }

  /**
   * Rewrites stage-level warnings from the final canonical ledger rather than
   * preserving provisional pre-verification statements that may already have
   * become false. Community AI can initially classify every row as context,
   * while the deterministic canonical verifier later admits tightly aligned
   * SUPPORTING_SIGNAL rows. Once that happens, warnings such as "every item was
   * unrelated" are stale and must not leak into the persisted run snapshot.
   */
  private buildCanonicalTruthWarnings(
    current: readonly string[],
    snapshot: ReturnType<typeof CanonicalEvidenceStateUtil.compute>,
    hasCanonicalFamilyLock: boolean,
  ): string[] {
    const staleZeroEvidenceWarning = (warning: string): boolean =>
      /every classified raw evidence item was unrelated/iu.test(warning) ||
      /first-pass discovery corpus contained no trusted problem-bearing evidence/iu.test(
        warning,
      ) ||
      /canonical evidence state is (?:NO_VALID_EVIDENCE_FOUND|EVIDENCE_ADJUDICATION_UNAVAILABLE)/iu.test(warning);

    const warnings = snapshot.trustedCount > 0
      ? current.filter((warning) => !staleZeroEvidenceWarning(warning))
      : [...current];

    if (snapshot.trustedCount > 0 && snapshot.sourceCount <= 1) {
      const sourceScope = snapshot.sourceCount === 1
        ? 'one independent source'
        : 'an unresolved independent-source set';
      warnings.push(
        `Canonical evidence retained ${snapshot.trustedCount} trusted problem signal(s) from ${sourceScope}. This supports a preliminary problem signal only; recurrence, prevalence, and cross-market demand remain unvalidated.`,
      );
    }

    if (snapshot.trustedCount > 0 && !hasCanonicalFamilyLock) {
      warnings.push(
        'Trusted canonical evidence exists, but no single problem-family identity survived the immutable family-lock check. Downstream stages may use the rows as supporting evidence but must not describe a family as validated or locked.',
      );
    }

    return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
  }

  private toJsonArray(values: readonly unknown[]): Prisma.JsonArray {
    return values as Prisma.JsonArray;
  }

  private mergeJsonArrays(
    current: Prisma.JsonValue | null,
    additions: readonly Prisma.InputJsonValue[],
  ): Prisma.JsonArray {
    const existing = Array.isArray(current) ? current : [];
    return [...existing, ...additions] as Prisma.JsonArray;
  }

  private mergeConfidence(
    deterministicConfidence: number | null,
    aiConfidence: number,
  ): number {
    if (deterministicConfidence === null) {
      return aiConfidence;
    }
    return (
      Math.round((deterministicConfidence * 0.4 + aiConfidence * 0.6) * 1000) /
      1000
    );
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(`Missing stage definition for ${this.key}.`);
    }
    return definition;
  }
  private hasExplicitRequesterProblem(context: IdeaGenerationContext): boolean {
    const intent = context.collectionPlan?.requestIntent;
    return Boolean(
      context.requestDescription?.trim() &&
      intent?.mode === 'EXPLICIT_PROBLEM' &&
      intent.explicitProblem?.trim(),
    );
  }

}