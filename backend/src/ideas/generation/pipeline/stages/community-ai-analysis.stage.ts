import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
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
import { resolvePrimaryProblemFamily } from '../../../../nlp/common/utils/problem-family-matching.util';
import { RequestEvidenceAlignmentUtil } from '../../utils/request-evidence-alignment.util';
import { CanonicalEvidenceVerificationUtil } from '../../utils/canonical-evidence-verification.util';
import { CanonicalEvidenceStateUtil } from '../../utils/canonical-evidence-state.util';

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
    const hasSelectedDomainEvidence =
      this.hasAnyRetainedSelectedDomainEvidence(context);
    const hasRequestAlignedEvidence = plannedRequest
      ? this.hasAnyRetainedRequestAlignedEvidence(context)
      : hasSelectedDomainEvidence;
    const hasGroundedEvidenceForOnlineAi = plannedRequest
      ? hasRequestAlignedEvidence
      : hasSelectedDomainEvidence;
    const retainedEvidenceCount = this.countRetainedEvidenceTexts(context);
    const rawEvidenceCandidateCount = context.rawEvidenceCorpus?.length ?? 0;
    const hasRawAiTriageCorpus = plannedRequest && rawEvidenceCandidateCount > 0;
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
        item.origin === 'COMMUNITY_AI'
          ? 'AI semantic triage accepted this evidence after deterministic verification.'
          : 'Canonical evidence ledger admitted a concrete external problem signal after deterministic verification.',
      problemFamily: item.problemFamily,
      verifiedByDeterministicGuard: item.verified,
    }));
    const canonicalState = CanonicalEvidenceStateUtil.compute(canonicalEvidenceLedger);
    const synchronizedAnalysis: CommunityAiAnalysis = {
      ...analysis,
      evidenceClassifications: canonicalClassifications,
    };

    const enrichedNlp: IdeaGenerationNlpContext = {
      ...context.nlp,
      recurringProblems: plannedRequest
        ? this.toJsonArray(
            analysis.opportunities.map((opportunity) => ({
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
            analysis.opportunities.map((opportunity) => ({
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
      extractedNeeds: plannedRequest
        ? this.toJsonArray(
            analysis.opportunities.map((opportunity) => ({
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
            analysis.opportunities.map((opportunity) => ({
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
      opportunities: this.toNlpOpportunities(analysis.opportunities),
      insights: this.mergeJsonArrays(context.nlp.insights, [
        {
          type: 'COMMUNITY_AI_ANALYSIS',
          summary: analysis.summary,
          dominantProblems: [...analysis.dominantProblems],
          unmetNeeds: [...analysis.unmetNeeds],
          overallConfidence: analysis.overallConfidence,
          qualityWarnings: [...analysis.qualityWarnings],
          modelId: analysis.modelId,
          apiModelId: analysis.apiModelId,
          attemptCount: analysis.attemptCount,
          aiAttempted: analysis.aiAttempted,
          triageAiSucceeded: analysis.triageAiSucceeded ?? false,
          synthesisAiSucceeded: analysis.synthesisAiSucceeded ?? analysis.aiSucceeded,
          aiSucceeded: analysis.aiSucceeded,
          fallbackUsed: analysis.fallbackUsed,
          onlineAttemptCount: analysis.onlineAttemptCount,
          executionFailureCount: analysis.executionFailureCount,
          validationRejectedCount: analysis.validationRejectedCount,
          fallbackReason: analysis.fallbackReason,
          attemptDiagnostics: analysis.attemptDiagnostics.map((item) => ({ ...item })),
          unvalidatedDomainHypotheses: analysis.unvalidatedDomainHypotheses.map(
            (item) => ({ ...item, risks: [...item.risks] }),
          ),
          evidenceClassifications: canonicalClassifications.map((item) => ({ ...item })),
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
          evidencePipelineSemantics:
            'Raw collector candidates are semantically triaged before final trusted evidence admission. nlpProcessedEvidenceCount measures preprocessing throughput; trustedNlpEvidenceCount counts only DIRECT_PROBLEM + SUPPORTING_SIGNAL classifications.',
          directEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.verifiedByDeterministicGuard && item.classification === 'DIRECT_PROBLEM',
            ).length,
          supportingEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.verifiedByDeterministicGuard && item.classification === 'SUPPORTING_SIGNAL',
            ).length,
          contextOnlyEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.classification === 'CONTEXT_ONLY',
            ).length,
          unrelatedEvidenceClassificationCount:
            canonicalClassifications.filter(
              (item) => item.classification === 'UNRELATED',
            ).length,
        },
      ]),
      aiUsed: context.nlp.aiUsed || analysis.aiAttempted || analysis.aiSucceeded,
      confidence: this.mergeConfidence(
        context.nlp.confidence,
        analysis.overallConfidence / 100,
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
        const groundedCount = analysis.opportunities.filter(
          (opportunity) => opportunity.evidenceSamples.length > 0,
        ).length;
        const hypothesisCount = analysis.unvalidatedDomainHypotheses.length;

        if (groundedCount > 0 && hypothesisCount === 0) {
          return `Community AI analysis extracted ${groundedCount} evidence-grounded opportunity candidate(s).`;
        }

        if (groundedCount > 0) {
          return `Generated ${groundedCount} grounded opportunity candidate(s) and kept ${hypothesisCount} unsupported domain hypothesis candidate(s) separate from evidence ranking.`;
        }

        return `No grounded Community AI opportunity survived validation; ${hypothesisCount} unvalidated domain hypothesis candidate(s) were kept separate for last-resort use.`;
      })(),
      metadata: {
        analysisLayer: 'IDEA_OPPORTUNITY_ENRICHMENT',
        duplicatesNlpAiEnhancement: false,
        aiAnalysisApplied: analysis.aiAttempted || analysis.aiSucceeded,
        opportunityCount: analysis.opportunities.length,
        overallConfidence: analysis.overallConfidence,
        modelId: analysis.modelId,
        apiModelId: analysis.apiModelId,
        attemptCount: analysis.attemptCount,
        aiAttempted: analysis.aiAttempted,
        triageAiSucceeded: analysis.triageAiSucceeded ?? false,
        synthesisAiSucceeded: analysis.synthesisAiSucceeded ?? analysis.aiSucceeded,
        aiSucceeded: analysis.aiSucceeded,
        fallbackUsed: analysis.fallbackUsed,
        onlineAttemptCount: analysis.onlineAttemptCount,
        executionFailureCount: analysis.executionFailureCount,
        validationRejectedCount: analysis.validationRejectedCount,
        fallbackReason: analysis.fallbackReason,
        attemptDiagnostics: analysis.attemptDiagnostics,
        qualityWarnings: analysis.qualityWarnings,
        representedDomains: [...new Set(analysis.opportunities.map((item) => item.domainName))],
        unvalidatedDomainHypothesisCount: analysis.unvalidatedDomainHypotheses.length,
        canonicalTrustedEvidenceCount: canonicalEvidenceLedger.filter(
          (item) => item.verified &&
            (item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL'),
        ).length,
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
          origin: 'COMMUNITY_AI',
        },
        requestMode: context.requestMode,
        problemSpec: context.canonicalProblemSpec,
        selectedDomains: context.selectedDomains,
      });
      ledger.set(raw.id, verified);
    }

    /*
     * Discovery paths may continue when the online triage produced no usable
     * classifications, but deterministic fallback goes through the exact same
     * canonical verifier. Retrieval provenance is not evidence: a technical
     * ticket found while probing IoT, for example, cannot become DIRECT unless
     * the evidence text itself semantically matches the discovery domain and
     * contains a concrete human problem signal.
     */
    if (!context.requestDescription?.trim()) {
      for (const raw of context.rawEvidenceCorpus ?? []) {
        if (ledger.has(raw.id)) continue;
        const kind = classifyDirectCommunityEvidence(raw.text, raw.sourceType);
        if (kind !== 'USER_COMPLAINT' && kind !== 'FEATURE_REQUEST' && kind !== 'OBSERVED_UNMET_NEED') {
          continue;
        }
        const verified = CanonicalEvidenceVerificationUtil.verify({
          raw,
          proposal: {
            classification: 'DIRECT_PROBLEM',
            confidence: 70,
            problemFamily: resolvePrimaryProblemFamily(raw.text)?.key || null,
            verifiedByDeterministicGuard: true,
            origin: 'DOMAIN_DIRECT_FALLBACK',
          },
          requestMode: context.requestMode,
          problemSpec: context.canonicalProblemSpec,
          selectedDomains: context.selectedDomains,
        });
        ledger.set(raw.id, verified);
      }
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
    const missingEvidenceDomains: string[] = [];
    const hypotheses: CommunityAiDomainHypothesis[] = [
      ...analysis.unvalidatedDomainHypotheses,
    ];

    for (const domain of context.selectedDomains) {
      const key = domain.name.trim().toLocaleLowerCase();
      if (represented.has(key)) continue;

      const hasRetainedEvidence = this.hasRetainedDomainEvidence(
        context,
        domain.id,
      );
      const hasRetainedDirectEvidence = this.hasRetainedDirectDomainEvidence(
        context,
        domain.id,
      );

      if (hasRetainedEvidence || hasRetainedDirectEvidence) {
        continue;
      }

      missingEvidenceDomains.push(domain.name);

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
        ...(missingEvidenceDomains.length > 0 &&
        context.domainResolution?.source === 'USER_SELECTED'
          ? [`No direct retained evidence was available for selected domain(s): ${missingEvidenceDomains.join(', ')}.`]
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
}