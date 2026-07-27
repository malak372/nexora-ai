import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  IDEA_OPPORTUNITY_EVIDENCE_TYPES,
  type IdeaOpportunityEvidenceType,
  type IdeaOpportunityRanking,
  type RankedIdeaOpportunity,
} from '../types/idea-opportunity-ranking.type';
import type { CommunityAiAnalysis } from '../types/community-ai-analysis.type';
import type { IdeaGenerationNlpContext } from '../types/idea-generation-context.type';

const MAX_EVIDENCE_SAMPLES = 5;
const MAX_EVIDENCE_SAMPLE_LENGTH = 700;
const MAX_RANKED_OPPORTUNITIES = 8;
const LOW_NLP_CONFIDENCE_THRESHOLD = 0.5;
const MIN_SELECTION_RELIABILITY = 0.42;
const MIN_LOW_CONFIDENCE_RELIABILITY = 0.52;
const MIN_EVIDENCE_RELEVANCE_SCORE = 0.34;
const MIN_GENERIC_RELIABILITY_RELEVANCE_SCORE = 0.46;
const INELIGIBLE_SELECTION_PENALTY = 0.12;
const MIN_STANDARD_SELECTION_EVIDENCE_SAMPLES = 2;

/** Labels that are too generic to be selected without concrete evidence. */
const GENERIC_LABELS = new Set([
  'app',
  'application',
  'available',
  'challenge',
  'difficulty',
  'feature',
  'feature request',
  'features',
  'information',
  'issue',
  'looking for',
  'need',
  'platform',
  'problem',
  'please add',
  'request',
  'suggestion',
  'see',
  'service',
  'solution',
  'system',
]);

const SEVERITY_SCORES: Readonly<Record<string, number>> = {
  CRITICAL: 1,
  HIGH: 0.85,
  MEDIUM: 0.6,
  LOW: 0.35,
};

const EVIDENCE_TYPE_SCORES: Readonly<
  Record<IdeaOpportunityEvidenceType, number>
> = {
  [IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM]: 1,
  [IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED]: 0.9,
  [IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST]: 0.82,
  [IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY]: 0.72,
};

/** Direct complaint patterns used to validate evidence quality. */
const DIRECT_COMPLAINT_PATTERNS: readonly RegExp[] = [
  /\bnot useful\b/iu,
  /\bnot helpful\b/iu,
  /\bdoes(?:n['’]?t| not) work\b/iu,
  /\b(?:can(?:not|['’]?t)|can\s+not)\b/iu,
  /\bcannot\b/iu,
  /\bunable to\b/iu,
  /\bnever (?:receive|received|get|got|arrive|arrived)\b/iu,
  /\b(?:lost|missing|deleted|gone)\b/iu,
  /\b(?:crash|crashes|crashed|freeze|broken|bug|error|failure)\b/iu,
  /\b(?:hard|difficult|confusing) to (?:use|navigate|access|find|download|install|login|log in)\b/iu,
  /\b(?:terrible|disappointing|frustrating|major problem|big problem)\b/iu,
  /\b(?:very limited|too limited|only works? in the simplest cases?|not useful results?|did not generate useful results?)\b/iu,
  /\b(?:stops?|cuts? off|ends?) (?:mid[- ]sentence|before (?:finishing|completing|providing))\b/iu,
  /\b(?:only getting part of it|incomplete (?:answer|response|output|information)|missing the rest)\b/iu,
  /\brelies? on the user to (?:determine|decide|verify|check)\b/iu,
  /\b(?:feature request|requested feature|requesting support for)\b/iu,
  /\b(?:would like|i(?:'d| would) like|wish|need|needs|needed|should|must)\b.{0,100}\b(?:add|support|allow|provide|improve|fix|enable|include)\b/iu,
  /\b(?:fails? to|failed to|unable to|cannot|can['’]?t)\b.{0,120}\b(?:generate|process|open|load|save|sync|access|complete|finish)\b/iu,
  /\b(?:slow|unreliable|unstable|inaccurate|incorrect|incomplete|limited|missing|unavailable)\b/iu,
  /(?:غير مفيد|لا يعمل|ما بشتغل|لا أستطيع|لا يمكن|لم يصل|فقدت|اختفت|تعطل|خطأ|صعب التنقل|واجهة مربكة)/iu,
];

/** Promotional descriptions that should not be accepted as problem evidence. */
const PROMOTIONAL_PATTERNS: readonly RegExp[] = [
  /\b(?:why choose|join millions|trusted by|privacy policy|membership details|download .* today|proven results|full curriculum)\b/iu,
  /\b(?:available on|personalized learning|detailed features|official app)\b/iu,
  /\b(?:continuous updates?(?:\s*&\s*support)?|we(?:'re| are) constantly improving|new features?,? bug fixes?|enhanced analytics|free to start|perfect for)\b/iu,
];

const VAGUE_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /^(?:very\s+)?(?:bad|terrible|awful|horrible|useless)(?:\s+(?:app|application|service|system))?[.!…]*$/iu,
  /^(?:what\s+a\s+)?terrible\s+logic[.!…]*$/iu,
  /^(?:doesn['’]?t\s+work|not\s+working)[.!…]*$/iu,
  /^(?:سيئ|سيء|فظيع|تطبيق\s+سيئ|لا\s+يعمل)[.!…]*$/iu,
];

/** Texts that are conversational or emotional but do not describe a product problem. */
const NON_DIAGNOSTIC_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:lost hope|found hope|didn['’]?t think it would come back|feel(?:ing)? hopeless)\b/iu,
  /\b(?:love this|great app|amazing app|thank you|good job|best app)\b/iu,
  /^(?:please\s+)?(?:fix|correct)\s+(?:this|it|the error)[.!…]*$/iu,
  /^(?:please\s+)?(?:correct|fix)\s+(?:this\s+)?(?:error|bug|issue)[.!…]*$/iu,
  /^(?:something|anything)\s+(?:went|goes)\s+wrong[.!…]*$/iu,
  /^(?:help|please help|any update|same here|me too)[.!…]*$/iu,
  /(?:فقدت الأمل|رجع الأمل|تطبيق رائع|شكراً|ساعدوني|نفس المشكلة فقط)[.!…]*$/iu,
];

const CONCRETE_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:connect|disconnect|sync|crash|freeze|glitch|error|delete|save|load|login|schedule|irrigat|controller|notification|payment|upload|download|offline|network|bluetooth|firmware|privacy|consent|browser|on-device|local processing|external server|algorithm|encode|decode|recipe|orchestration|routing|registration|discovery)\w*\b/iu,
  /\b(?:cannot|can['’]?t|unable|fails?\s+to|failed\s+to|without\s+warning)\b/iu,
  /(?:اتصال|ينفصل|مزامنة|تعطل|خطأ|حذف|حفظ|تحميل|دخول|جدولة|ري|متحكم|إشعار|دفع|بدون\s+تحذير)/iu,
];

type NormalizedCandidate = {
  title: string;
  problem: string | null;
  need: string | null;
  solutionArea: string | null;
  evidenceType: IdeaOpportunityEvidenceType;
  sourceIndex: number;
  frequency: number;
  severity: string | null;
  evidenceSamples: string[];
  raw: Prisma.JsonValue;
};

/**
 * Signals that NLP completed successfully but produced no candidate that can
 * be ranked. The pipeline treats this as insufficient evidence, not as an NLP
 * execution failure, and may run bounded evidence recovery.
 */
export class NoRankedIdeaOpportunityError extends Error {
  constructor() {
    super(
      'NLP analysis did not contain a concrete evidence-backed opportunity.',
    );
    this.name = 'NoRankedIdeaOpportunityError';
  }
}

/**
 * Converts persisted NLP output into deterministic evidence-aware opportunity
 * ranking.
 */
@Injectable()
export class IdeaOpportunityRankingService {
  /** Ranks problems, needs, feature requests, and NLP opportunities. */
  rank(
    nlp: IdeaGenerationNlpContext,
    locationTerms: readonly string[],
    previousIdeaTexts: readonly string[] = [],
    communityAiAnalysis: CommunityAiAnalysis | null = null,
  ): IdeaOpportunityRanking {
    const extractedCandidates = [
      ...this.extractCommunityAiCandidates(communityAiAnalysis),
      ...this.extractCandidates(
        nlp.recurringProblems,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM,
      ),
      ...this.extractCandidates(
        nlp.extractedNeeds,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED,
      ),
      ...this.extractCandidates(
        nlp.featureRequests,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST,
      ),
      ...this.extractCandidates(
        nlp.opportunities,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY,
      ),
    ];

    const normalizedCandidates = extractedCandidates
      .map((candidate) => this.normalizeCandidate(candidate))
      .filter((candidate): candidate is NormalizedCandidate =>
        Boolean(candidate),
      );

    const consolidatedCandidates =
      this.consolidateEquivalentCandidates(normalizedCandidates);

    const scoredCandidates = consolidatedCandidates.map((candidate) =>
      this.scoreCandidate(
        candidate,
        locationTerms,
        previousIdeaTexts,
        nlp.confidence ?? 0,
      ),
    );

    /*
     * Prefer a ranking set composed only of candidates that retain direct,
     * validated evidence. Unsupported semantic summaries remain useful for
     * diagnostics, but including them as normal alternatives artificially
     * lowers evidence coverage and can distract downstream generation.
     *
     * When no candidate retains evidence, keep the complete scored set so the
     * existing bounded recovery/fallback path can still explain and handle the
     * insufficient-evidence condition instead of failing silently.
     */
    const evidenceBackedCandidates = scoredCandidates.filter(
      (candidate) => candidate.evidenceSamples.length > 0,
    );
    const candidatesToRank =
      evidenceBackedCandidates.length > 0
        ? evidenceBackedCandidates
        : scoredCandidates;

    const ranked = candidatesToRank
      .sort((first, second) => {
        // Eligibility is reflected through a deterministic score penalty.
        // It is not used as a hard ordering gate so the strongest available
        // fallback remains selectable when evidence recovery is exhausted.
        const supportDifference = second.supportScore - first.supportScore;

        if (Math.abs(supportDifference) >= 0.12) {
          return supportDifference;
        }

        const reliabilityDifference =
          second.evidenceReliabilityScore - first.evidenceReliabilityScore;

        if (Math.abs(reliabilityDifference) >= 0.12) {
          return reliabilityDifference;
        }

        const scoreDifference = second.finalScore - first.finalScore;

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return (
          second.evidenceSamples.length - first.evidenceSamples.length ||
          second.frequency - first.frequency ||
          first.title.localeCompare(second.title)
        );
      })
      .slice(0, MAX_RANKED_OPPORTUNITIES)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    if (ranked.length === 0) {
      throw new NoRankedIdeaOpportunityError();
    }

    const evidenceBacked = ranked.filter(
      (candidate) => candidate.evidenceSamples.length > 0,
    ).length;
    const evidenceCoverage = this.round(
      evidenceBacked / Math.max(ranked.length, 1),
    );

    // Prefer the highest-ranked candidate that passed the exact eligibility
    // gate used by downstream generation. Previously ranked[0] could be an
    // intentionally penalized fallback with selectionEligible=false, while
    // the benchmark rejected that same candidate and aborted the run.
    const eligibleWinner = ranked.find(
      (candidate) => candidate.selectionEligible,
    );
    const selectedCandidate = eligibleWinner ?? ranked[0];
    const orderedCandidates = [
      selectedCandidate,
      ...ranked.filter((candidate) => candidate !== selectedCandidate),
    ].map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const selected = orderedCandidates[0];
    const alternatives = orderedCandidates.slice(1);

    return {
      selected,
      alternatives,
      evaluatedCount: extractedCandidates.length,
      evidenceCoverage,
      selectionReason: this.buildSelectionReason(selected, alternatives[0]),
      qualityWarnings: this.buildQualityWarnings(
        nlp,
        orderedCandidates,
        evidenceCoverage,
      ),
    };
  }

  private buildSelectionReason(
    selected: RankedIdeaOpportunity,
    runnerUp: RankedIdeaOpportunity | undefined,
  ): string {
    const selectedScore = (selected.finalScore * 100).toFixed(1);
    const evidenceCount = selected.evidenceSamples.length;
    const runnerUpText = runnerUp
      ? ` It outranked "${runnerUp.title}" by ${(
          (selected.finalScore - runnerUp.finalScore) *
          100
        ).toFixed(1)} point(s).`
      : '';

    return [
      `"${selected.title}" was selected with ${selectedScore}/100.`,
      `The decision used ${evidenceCount} direct evidence sample(s), frequency ${selected.frequency},`,
      `severity ${selected.severity ?? 'UNSPECIFIED'},`,
      `specificity ${(selected.specificityScore * 100).toFixed(1)}/100,`,
      `feasibility ${(selected.feasibilityScore * 100).toFixed(1)}/100,`,
      `evidence quality ${(selected.evidenceScore * 100).toFixed(1)}/100,`,
      `evidence reliability ${(selected.evidenceReliabilityScore * 100).toFixed(1)}/100,`,
      `support ${(selected.supportScore * 100).toFixed(1)}/100,`,
      `NLP confidence ${(selected.nlpConfidenceScore * 100).toFixed(1)}/100,`,
      `confidence penalty ${(selected.confidencePenalty * 100).toFixed(1)} point(s),`,
      `weak-evidence penalty ${(selected.weakEvidencePenalty * 100).toFixed(1)} point(s),`,
      `novelty ${(selected.noveltyScore * 100).toFixed(1)}/100,`,
      `business value ${(selected.businessValueScore * 100).toFixed(1)}/100,`,
      `market gap ${(selected.marketGapScore * 100).toFixed(1)}/100,`,
      `and technical risk ${(selected.technicalRiskScore * 100).toFixed(1)}/100.`,
      runnerUpText,
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  /**
   * Converts validated LLM opportunities into ranking candidates. They are
   * still evaluated by the deterministic evidence gate, while NLP-derived
   * candidates remain available as a fallback when AI analysis is unavailable.
   */
  private extractCommunityAiCandidates(
    analysis: CommunityAiAnalysis | null,
  ): NormalizedCandidate[] {
    if (!analysis) {
      return [];
    }

    return analysis.opportunities.map((opportunity, sourceIndex) => ({
      title: opportunity.title,
      problem: opportunity.problem,
      need: opportunity.unmetNeed,
      solutionArea: opportunity.solutionArea,
      evidenceType: IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY,
      sourceIndex,
      frequency: opportunity.frequency,
      severity: opportunity.severity,
      evidenceSamples: [...opportunity.evidenceSamples],
      raw: {
        ...opportunity,
        source: 'COMMUNITY_AI_ANALYSIS',
        groundingScore: opportunity.groundingScore,
        localEvidenceAvailable: opportunity.localEvidenceAvailable,
      } as unknown as Prisma.JsonValue,
    }));
  }

  private extractCandidates(
    value: Prisma.JsonValue | null,
    evidenceType: IdeaOpportunityEvidenceType,
  ): NormalizedCandidate[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((entry, sourceIndex) => {
      if (!this.isJsonObject(entry)) {
        return [];
      }

      const problem =
        this.readString(entry.problem) ??
        (evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM
          ? this.readString(entry.title)
          : null);
      const need =
        this.readString(entry.need) ??
        (evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED
          ? this.readString(entry.title)
          : null);
      const solutionArea = this.readString(entry.solutionArea);
      const feature = this.readString(entry.feature);
      const request = this.readString(entry.request);
      const title =
        (evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST
          ? (feature ?? request)
          : null) ??
        this.readString(entry.title) ??
        problem ??
        need ??
        solutionArea ??
        feature ??
        request ??
        this.readString(entry.topic) ??
        '';

      return [
        {
          title,
          problem,
          need,
          solutionArea,
          evidenceType,
          sourceIndex,
          frequency: this.readNumber(entry.frequency),
          severity: this.readString(entry.severity)?.toUpperCase() ?? null,
          evidenceSamples: this.readStringArray(entry.evidenceSamples),
          raw: entry,
        },
      ];
    });
  }

  /** Returns true when the candidate came from validated community AI analysis. */
  private isCommunityAiCandidate(candidate: NormalizedCandidate): boolean {
    return (
      this.isJsonObject(candidate.raw) &&
      ['COMMUNITY_AI_ANALYSIS', 'COMMUNITY_LLM_ANALYSIS'].includes(
        this.readString(candidate.raw.source) ?? '',
      )
    );
  }

  /**
   * Accepts evidence only when it is the same corpus-backed sample returned by
   * the validated Community AI stage and that stage assigned an acceptable
   * deterministic grounding score.
   *
   * This source-aware path is intentionally separate from complaint-pattern
   * detection because Community AI evidence may be a developer workflow
   * description or feature request rather than a negative review.
   */
  private isAcceptedCommunityAiEvidence(
    candidate: NormalizedCandidate,
    sample: string,
  ): boolean {
    if (
      !this.isCommunityAiCandidate(candidate) ||
      !this.isJsonObject(candidate.raw)
    ) {
      return false;
    }

    const source = this.readString(candidate.raw.source) ?? '';
    const groundingScore = this.readNumber(candidate.raw.groundingScore);
    const confidence = Math.max(
      this.readNumber(candidate.raw.confidence),
      this.readNumber(candidate.raw.aiConfidence),
    );

    /*
     * COMMUNITY_AI_ANALYSIS records expose a deterministic groundingScore.
     * COMMUNITY_LLM_ANALYSIS records are the validated copy merged into NLP
     * sections and may no longer carry groundingScore. In that case, require
     * high model confidence and an exact corpus sample match instead of
     * dropping otherwise valid evidence.
     */
    const hasAcceptedGrounding =
      source === 'COMMUNITY_AI_ANALYSIS'
        ? groundingScore >= 50
        : source === 'COMMUNITY_LLM_ANALYSIS' && confidence >= 70;

    if (!hasAcceptedGrounding) {
      return false;
    }

    const normalizedSample = this.normalizeEvidenceSample(sample);
    const rawSamples = this.readStringArray(candidate.raw.evidenceSamples).map(
      (rawSample) => this.normalizeEvidenceSample(rawSample),
    );

    return rawSamples.some(
      (rawSample) =>
        rawSample === normalizedSample ||
        rawSample.startsWith(normalizedSample) ||
        normalizedSample.startsWith(rawSample),
    );
  }

  private normalizeCandidate(
    candidate: NormalizedCandidate,
  ): NormalizedCandidate | null {
    const isCommunityAiCandidate = this.isCommunityAiCandidate(candidate);
    const rawCandidate =
      isCommunityAiCandidate && this.isJsonObject(candidate.raw)
        ? candidate.raw
        : null;

    /*
     * Community-AI opportunities are already schema-validated before ranking.
     * Read their structured fields from raw as a defensive fallback so a
     * mapper or serialization change cannot silently drop solutionArea or
     * evidenceSamples before deterministic scoring.
     */
    const workingCandidate: NormalizedCandidate = {
      ...candidate,
      problem:
        candidate.problem ??
        (rawCandidate ? this.readString(rawCandidate.problem) : null),
      need:
        candidate.need ??
        (rawCandidate ? this.readString(rawCandidate.unmetNeed) : null),
      solutionArea:
        candidate.solutionArea ??
        (rawCandidate ? this.readString(rawCandidate.solutionArea) : null),
      evidenceSamples:
        candidate.evidenceSamples.length > 0
          ? candidate.evidenceSamples
          : rawCandidate
            ? this.readStringArray(rawCandidate.evidenceSamples)
            : [],
    };

    /*
     * Reject structurally incomplete NLP opportunities. A solution area alone
     * is not a user need or problem and must not enter deterministic ranking.
     * Validated community-AI candidates provide both problem and unmet need,
     * and the defensive raw-field fallback above preserves those descriptors.
     */
    if (
      workingCandidate.evidenceType ===
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY &&
      !isCommunityAiCandidate &&
      !workingCandidate.problem &&
      !workingCandidate.need
    ) {
      return null;
    }

    const normalizedEvidence = workingCandidate.evidenceSamples
      .map((sample) => this.normalizeEvidenceSample(sample))
      .filter(Boolean)
      .filter((sample) => !this.isPromotionalOnlyEvidence(sample))
      .filter((sample) => !this.isNonDiagnosticEvidence(sample));

    const directEvidence = normalizedEvidence
      .filter(
        (sample) =>
          this.hasDirectComplaintSignal(sample) &&
          this.isEvidenceRelevantToCandidate(workingCandidate, sample),
      )
      .map((sample) => ({
        sample,
        quality: this.calculateEvidenceQuality(sample),
      }))
      .filter((item) => item.quality >= 0.45)
      .sort(
        (first, second) =>
          second.quality - first.quality ||
          second.sample.length - first.sample.length,
      )
      .map((item) => item.sample);

    /*
     * Community-AI evidence is not required to use complaint wording. A
     * feature request, workflow explanation, or developer report can be direct
     * evidence when it was included in the validated Community AI result and
     * the deterministic grounding score passed the accepted threshold.
     */
    const groundedCommunityEvidence = isCommunityAiCandidate
      ? normalizedEvidence.filter((sample) =>
          this.isAcceptedCommunityAiEvidence(workingCandidate, sample),
        )
      : [];

    const originalTitle = workingCandidate.title.replace(/\s+/gu, ' ').trim();
    const normalizedTitle = originalTitle.toLowerCase();
    const titleDerivationEvidence =
      directEvidence.length > 0
        ? directEvidence
        : groundedCommunityEvidence.length > 0
          ? groundedCommunityEvidence
          : normalizedEvidence;
    const evidenceDerivedTitle = this.deriveConcreteTitle(
      titleDerivationEvidence,
    );
    const structuredFeatureTitle =
      workingCandidate.evidenceType ===
      IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST
        ? this.deriveFeatureRequestTitle(
            workingCandidate,
            titleDerivationEvidence,
          )
        : null;
    const derivedTitle = structuredFeatureTitle ?? evidenceDerivedTitle;
    const structuredFallbackTitle =
      workingCandidate.evidenceType ===
      IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST
        ? (workingCandidate.title ??
          workingCandidate.solutionArea ??
          workingCandidate.need)
        : (workingCandidate.problem ??
          workingCandidate.need ??
          workingCandidate.solutionArea ??
          null);
    const tentativeTitle =
      GENERIC_LABELS.has(normalizedTitle) ||
      originalTitle.split(/\s+/u).length < 2
        ? (derivedTitle ?? structuredFallbackTitle)
        : originalTitle;
    const finalTitle = tentativeTitle
      ? this.canonicalizeOpportunityTitle(tentativeTitle)
      : null;

    if (!finalTitle) {
      return null;
    }

    const relevantEvidence = normalizedEvidence
      .map((sample) => ({
        sample,
        relevanceScore: this.calculateEvidenceRelevanceScore(
          workingCandidate,
          finalTitle,
          sample,
        ),
      }))
      .filter(({ sample, relevanceScore }) => {
        if (this.meetsEvidenceRelevanceThreshold(finalTitle, relevanceScore)) {
          return true;
        }

        /*
         * Preserve evidence that the validated Community AI stage already
         * grounded against the original corpus. The exact-evidence and
         * grounding checks prevent unrelated text from bypassing ranking.
         */
        return (
          isCommunityAiCandidate &&
          this.isAcceptedCommunityAiEvidence(workingCandidate, sample)
        );
      })
      .sort(
        (first, second) =>
          second.relevanceScore - first.relevanceScore ||
          this.calculateEvidenceQuality(second.sample) -
            this.calculateEvidenceQuality(first.sample),
      )
      .map(({ sample }) => sample);

    /**
     * Keep only evidence that has a defensible connection to the opportunity.
     * Community-AI evidence may qualify through its validated corpus-grounding
     * record even when it is phrased as a feature request rather than a direct
     * complaint.
     */
    const evidenceSamples = this.deduplicateEvidenceSamples([
      ...groundedCommunityEvidence,
      ...relevantEvidence,
      ...directEvidence.filter((sample) =>
        this.isEvidenceAcceptableForOpportunity(
          workingCandidate,
          finalTitle,
          sample,
        ),
      ),
    ]).slice(0, MAX_EVIDENCE_SAMPLES);

    const requiresDirectEvidence =
      workingCandidate.evidenceType ===
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM ||
      workingCandidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED;
    const hasAcceptedDirectEvidence = directEvidence.some((sample) =>
      this.isEvidenceAcceptableForOpportunity(
        workingCandidate,
        finalTitle,
        sample,
      ),
    );

    if (
      requiresDirectEvidence &&
      (!hasAcceptedDirectEvidence || evidenceSamples.length === 0)
    ) {
      return null;
    }

    const alignedDescriptors = this.deriveAlignedDescriptors(
      finalTitle,
      workingCandidate.problem,
      workingCandidate.need,
      workingCandidate.solutionArea,
      isCommunityAiCandidate,
    );

    return {
      ...workingCandidate,
      title: finalTitle,
      problem: alignedDescriptors.problem,
      need: alignedDescriptors.need,
      solutionArea: alignedDescriptors.solutionArea,
      evidenceSamples: evidenceSamples.slice(0, MAX_EVIDENCE_SAMPLES),
    };
  }

  /**
   * Keeps problem descriptors aligned with the selected canonical title.
   * NLP arrays may contain partially overlapping records, so descriptors from
   * an unrelated candidate must not leak into the stronger merged candidate.
   */
  private deriveAlignedDescriptors(
    title: string,
    problem: string | null,
    need: string | null,
    solutionArea: string | null,
    preserveStructuredDescriptors = false,
  ): {
    problem: string;
    need: string | null;
    solutionArea: string | null;
  } {
    if (preserveStructuredDescriptors) {
      return {
        problem:
          problem && !GENERIC_LABELS.has(problem.toLowerCase())
            ? problem
            : title,
        need: need && !GENERIC_LABELS.has(need.toLowerCase()) ? need : null,
        solutionArea:
          solutionArea && !GENERIC_LABELS.has(solutionArea.toLowerCase())
            ? solutionArea
            : null,
      };
    }

    const context = [title, problem].filter(Boolean).join(' ').toLowerCase();

    // Authentication and subscription recovery are separate workflows.
    // Check authentication first so titles such as "Account Activation and
    // Login Failures" cannot be mislabeled as subscription restoration.
    if (
      /\b(?:login|log in|sign in|authentication|activation|identity|verification|session|token|handshake|account activation|account recovery)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: title,
        need: 'Reliable Login and Session Recovery',
        solutionArea: 'Authentication and Session Recovery',
      };
    }

    if (
      /\b(?:subscription|purchase|payment|billing|renewal|receipt|restore purchase|purchase restoration|subscription restoration)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: title,
        need: 'Reliable Subscription Restoration and Account Access',
        solutionArea: 'Subscription Verification and Purchase Recovery',
      };
    }

    if (
      /\b(?:crash|freeze|stuck|unresponsive|runtime|state loss|lost progress|recovery)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: title,
        need: 'Stable Crash-resistant Operation',
        solutionArea: 'Application Reliability and Performance Recovery',
      };
    }

    const normalizedProblem =
      problem && !GENERIC_LABELS.has(problem.toLowerCase()) ? problem : title;
    const normalizedNeed =
      need && !GENERIC_LABELS.has(need.toLowerCase()) ? need : null;
    const normalizedSolutionArea =
      solutionArea &&
      this.descriptorMatchesCandidate(title, problem, solutionArea)
        ? solutionArea
        : null;

    return {
      problem: normalizedProblem,
      need: normalizedNeed,
      solutionArea: normalizedSolutionArea,
    };
  }

  /** Prevents a descriptor from being inherited only because of generic words. */
  private descriptorMatchesCandidate(
    title: string,
    problem: string | null,
    descriptor: string,
  ): boolean {
    const candidateTokens = this.toSemanticTokenSet(
      [title, problem].filter(Boolean).join(' '),
    );
    const descriptorTokens = this.toSemanticTokenSet(descriptor);

    return this.jaccardSimilarity(candidateTokens, descriptorTokens) >= 0.2;
  }

  /**
   * Consolidates candidates that express the same underlying opportunity even
   * when NLP returned different surface titles. Consolidation uses canonical
   * problem families, semantic similarity, and shared evidence fingerprints.
   */
  private consolidateEquivalentCandidates(
    candidates: readonly NormalizedCandidate[],
  ): NormalizedCandidate[] {
    const groups: NormalizedCandidate[] = [];

    for (const candidate of candidates) {
      const existingIndex = groups.findIndex((current) =>
        this.areEquivalentCandidates(current, candidate),
      );

      if (existingIndex < 0) {
        groups.push(candidate);
        continue;
      }

      const current = groups[existingIndex];
      const preferred = this.selectStrongerCandidate(current, candidate);
      const secondary = preferred === current ? candidate : current;
      /*
       * Re-filter merged evidence against the preferred canonical candidate.
       * This prevents evidence from a loosely similar opportunity (for
       * example chat-history loss or TCP failures) from inflating subscription
       * access evidence and its downstream score.
       */
      const evidenceSamples = this.deduplicateEvidenceSamples([
        ...preferred.evidenceSamples,
        ...secondary.evidenceSamples,
      ])
        .filter((sample) => {
          if (
            this.isEvidenceAcceptableForOpportunity(
              preferred,
              preferred.title,
              sample,
            )
          ) {
            return true;
          }

          /*
           * Preserve corpus-grounded Community AI evidence while merging it
           * into a stronger deterministic candidate. Without this secondary
           * check, the merge could choose a PROBLEM record as the preferred
           * candidate and then discard the Community AI quote merely because
           * it describes concrete bugs rather than an explicit crash. That
           * left two independent reports as a single-sample candidate and
           * incorrectly triggered INSUFFICIENT_EVIDENCE_COUNT.
           */
          return (
            this.isCommunityAiCandidate(secondary) &&
            this.isAcceptedCommunityAiEvidence(secondary, sample) &&
            this.hasSharedEvidenceFamily(
              [
                preferred.title,
                preferred.problem,
                preferred.need,
                preferred.solutionArea,
              ]
                .filter((value): value is string => Boolean(value))
                .join(' '),
              sample,
            )
          );
        })
        .slice(0, MAX_EVIDENCE_SAMPLES);

      const alignedDescriptors = this.deriveAlignedDescriptors(
        preferred.title,
        preferred.problem ?? secondary.problem,
        preferred.need ?? secondary.need,
        preferred.solutionArea ?? secondary.solutionArea,
        this.isCommunityAiCandidate(preferred),
      );

      groups[existingIndex] = {
        ...preferred,
        problem: alignedDescriptors.problem,
        need: alignedDescriptors.need,
        solutionArea: alignedDescriptors.solutionArea,
        /*
         * Sum frequency only for strongly equivalent records. Otherwise keep
         * the strongest observed count so generic semantic overlap cannot
         * manufacture demand.
         */
        frequency: this.mergeCandidateFrequency(preferred, secondary),
        severity: this.selectHigherSeverity(
          preferred.severity,
          secondary.severity,
        ),
        evidenceSamples,
        sourceIndex: Math.min(preferred.sourceIndex, secondary.sourceIndex),
      };
    }

    return groups;
  }

  /** Returns true when two candidates describe the same concrete opportunity. */
  private areEquivalentCandidates(
    first: NormalizedCandidate,
    second: NormalizedCandidate,
  ): boolean {
    const firstTitle = this.canonicalizeOpportunityTitle(first.title);
    const secondTitle = this.canonicalizeOpportunityTitle(second.title);

    if (firstTitle.toLocaleLowerCase() === secondTitle.toLocaleLowerCase()) {
      return true;
    }

    const firstContext = [
      firstTitle,
      first.problem,
      first.need,
      first.solutionArea,
      ...first.evidenceSamples,
    ]
      .filter(Boolean)
      .join(' ');
    const secondContext = [
      secondTitle,
      second.problem,
      second.need,
      second.solutionArea,
      ...second.evidenceSamples,
    ]
      .filter(Boolean)
      .join(' ');

    if (this.hasSharedEvidenceFamily(firstContext, secondContext)) {
      return true;
    }

    const titleSimilarity = this.jaccardSimilarity(
      this.toSemanticTokenSet(firstTitle),
      this.toSemanticTokenSet(secondTitle),
    );
    const evidenceSimilarity = this.jaccardSimilarity(
      this.toSemanticTokenSet(first.evidenceSamples.join(' ')),
      this.toSemanticTokenSet(second.evidenceSamples.join(' ')),
    );

    return titleSimilarity >= 0.5 || evidenceSimilarity >= 0.58;
  }

  /**
   * Combines observed demand without counting the same evidence more than once.
   *
   * Community AI opportunities are persisted in multiple NLP sections for
   * downstream compatibility. Those records can carry the same source count
   * and the same evidence quote, so summing their frequency would manufacture
   * demand (for example 3 + 3 + 3 = 9). Repeated evidence therefore keeps the
   * strongest observed count. Counts are added only when both candidates have
   * independent evidence sets that support the same concrete opportunity.
   */
  private mergeCandidateFrequency(
    first: NormalizedCandidate,
    second: NormalizedCandidate,
  ): number {
    const firstFrequency = Math.max(0, first.frequency);
    const secondFrequency = Math.max(0, second.frequency);

    if (!this.shouldAggregateFrequency(first, second)) {
      return Math.max(firstFrequency, secondFrequency);
    }

    return firstFrequency + secondFrequency;
  }

  /** Returns true only when equivalent candidates add independent support. */
  private shouldAggregateFrequency(
    first: NormalizedCandidate,
    second: NormalizedCandidate,
  ): boolean {
    const firstEvidence = new Set(
      first.evidenceSamples.map((sample) =>
        this.normalizeEvidenceSample(sample),
      ),
    );
    const secondEvidence = new Set(
      second.evidenceSamples.map((sample) =>
        this.normalizeEvidenceSample(sample),
      ),
    );
    const hasSharedEvidence = [...firstEvidence].some((sample) =>
      secondEvidence.has(sample),
    );

    if (hasSharedEvidence) {
      return false;
    }

    const firstTitle = this.canonicalizeOpportunityTitle(first.title);
    const secondTitle = this.canonicalizeOpportunityTitle(second.title);
    const titleSimilarity = this.jaccardSimilarity(
      this.toSemanticTokenSet(firstTitle),
      this.toSemanticTokenSet(secondTitle),
    );

    return (
      firstEvidence.size > 0 &&
      secondEvidence.size > 0 &&
      (firstTitle.toLowerCase() === secondTitle.toLowerCase() ||
        titleSimilarity >= 0.72)
    );
  }

  private selectStrongerCandidate(
    first: NormalizedCandidate,
    second: NormalizedCandidate,
  ): NormalizedCandidate {
    const typeDifference =
      EVIDENCE_TYPE_SCORES[second.evidenceType] -
      EVIDENCE_TYPE_SCORES[first.evidenceType];

    if (typeDifference !== 0) {
      return typeDifference > 0 ? second : first;
    }

    if (second.evidenceSamples.length !== first.evidenceSamples.length) {
      return second.evidenceSamples.length > first.evidenceSamples.length
        ? second
        : first;
    }

    return second.frequency > first.frequency ? second : first;
  }

  private selectHigherSeverity(
    first: string | null,
    second: string | null,
  ): string | null {
    if (!first) {
      return second;
    }

    if (!second) {
      return first;
    }

    return (SEVERITY_SCORES[second] ?? 0) > (SEVERITY_SCORES[first] ?? 0)
      ? second
      : first;
  }

  private scoreCandidate(
    candidate: NormalizedCandidate,
    locationTerms: readonly string[],
    previousIdeaTexts: readonly string[],
    nlpConfidence: number,
  ): Omit<RankedIdeaOpportunity, 'rank'> {
    const frequencyScore = Math.min(
      Math.log2(Math.max(candidate.frequency, 1) + 1) / 4,
      1,
    );
    const severityScore = candidate.severity
      ? (SEVERITY_SCORES[candidate.severity] ?? 0.45)
      : 0.45;
    const evidenceScore = Math.min(
      candidate.evidenceSamples.length / MAX_EVIDENCE_SAMPLES,
      1,
    );
    const directEvidenceRatio = this.calculateDirectEvidenceRatio(candidate);
    const evidenceQualityScore =
      this.calculateAverageEvidenceQuality(candidate);
    const evidenceReliabilityScore = this.calculateEvidenceReliability(
      candidate,
      evidenceScore,
      directEvidenceRatio,
      evidenceQualityScore,
    );
    const weakEvidencePenalty = this.calculateWeakEvidencePenalty(
      candidate,
      evidenceReliabilityScore,
    );
    const specificityScore = this.calculateSpecificity(candidate);
    const feasibilityScore = this.calculateFeasibility(candidate);
    const localRelevanceScore = this.calculateLocalRelevance(
      candidate,
      locationTerms,
    );
    const evidenceTypeScore = EVIDENCE_TYPE_SCORES[candidate.evidenceType];
    const noveltyScore = this.calculateNovelty(candidate, previousIdeaTexts);
    const businessValueScore = this.calculateBusinessValue(candidate);
    const marketGapScore = this.calculateMarketGap(candidate);
    const competitionScore = this.calculateCompetitionAdvantage(candidate);
    const technicalRiskScore = this.calculateTechnicalRisk(candidate);

    const weightedScore =
      frequencyScore * 0.07 +
      severityScore * 0.09 +
      evidenceScore * 0.08 +
      directEvidenceRatio * 0.1 +
      evidenceQualityScore * 0.17 +
      evidenceReliabilityScore * 0.15 +
      specificityScore * 0.06 +
      feasibilityScore * 0.06 +
      localRelevanceScore * 0.03 +
      evidenceTypeScore * 0.04 +
      noveltyScore * 0.06 +
      businessValueScore * 0.05 +
      marketGapScore * 0.02 +
      competitionScore * 0.01 +
      (1 - technicalRiskScore) * 0.01;

    // A historically repeated direction must not win merely because it has
    // high frequency or severity. The multiplier turns novelty into a real
    // gate while keeping evidence-backed alternatives comparable.
    const historicalDiversityMultiplier =
      previousIdeaTexts.length === 0
        ? 1
        : noveltyScore < 0.2
          ? 0.55
          : noveltyScore < 0.35
            ? 0.72
            : noveltyScore < 0.5
              ? 0.88
              : 1;

    const baseScore = Math.max(
      0,
      weightedScore * historicalDiversityMultiplier - weakEvidencePenalty,
    );
    const normalizedNlpConfidence = Math.max(0, Math.min(1, nlpConfidence));
    const supportScore = this.calculateSupportScore(
      candidate,
      evidenceScore,
      directEvidenceRatio,
      evidenceReliabilityScore,
      evidenceQualityScore,
    );
    const confidencePenalty = this.calculateConfidencePenalty(
      normalizedNlpConfidence,
      supportScore,
      evidenceReliabilityScore,
    );
    const disqualificationReasons = this.getDisqualificationReasons(
      candidate,
      normalizedNlpConfidence,
      evidenceReliabilityScore,
      supportScore,
      directEvidenceRatio,
      evidenceQualityScore,
    );
    const eligibilityPenalty =
      disqualificationReasons.length > 0 ? INELIGIBLE_SELECTION_PENALTY : 0;
    const finalScore = this.round(
      Math.max(0, baseScore - confidencePenalty - eligibilityPenalty),
    );

    return {
      ...candidate,
      frequencyScore: this.round(frequencyScore),
      severityScore: this.round(severityScore),
      evidenceScore: this.round(evidenceScore),
      evidenceReliabilityScore: this.round(evidenceReliabilityScore),
      weakEvidencePenalty: this.round(weakEvidencePenalty),
      specificityScore: this.round(specificityScore),
      feasibilityScore: this.round(feasibilityScore),
      localRelevanceScore: this.round(localRelevanceScore),
      noveltyScore: this.round(noveltyScore),
      businessValueScore: this.round(businessValueScore),
      marketGapScore: this.round(marketGapScore),
      competitionScore: this.round(competitionScore),
      technicalRiskScore: this.round(technicalRiskScore),
      supportScore: this.round(supportScore),
      nlpConfidenceScore: this.round(normalizedNlpConfidence),
      baseScore: this.round(baseScore),
      confidencePenalty: this.round(confidencePenalty),
      finalScore,
      selectionEligible: disqualificationReasons.length === 0,
      disqualificationReasons,
    };
  }

  private calculateSupportScore(
    candidate: NormalizedCandidate,
    evidenceScore: number,
    directEvidenceRatio: number,
    evidenceReliabilityScore: number,
    evidenceQualityScore: number,
  ): number {
    const frequencySupport = Math.min(candidate.frequency / 4, 1);
    const sampleSupport = Math.min(candidate.evidenceSamples.length / 3, 1);

    return Math.min(
      1,
      evidenceReliabilityScore * 0.32 +
        evidenceQualityScore * 0.28 +
        directEvidenceRatio * 0.18 +
        sampleSupport * 0.12 +
        frequencySupport * 0.1,
    );
  }

  private calculateConfidencePenalty(
    nlpConfidence: number,
    supportScore: number,
    evidenceReliabilityScore: number,
  ): number {
    const confidenceGap = 1 - nlpConfidence;
    const supportGap = 1 - supportScore;
    const reliabilityGap = 1 - evidenceReliabilityScore;

    return Math.min(
      0.24,
      confidenceGap * (supportGap * 0.13 + reliabilityGap * 0.09),
    );
  }

  private getDisqualificationReasons(
    candidate: NormalizedCandidate,
    nlpConfidence: number,
    evidenceReliabilityScore: number,
    supportScore: number,
    directEvidenceRatio: number,
    evidenceQualityScore: number,
  ): string[] {
    const reasons: string[] = [];

    if (candidate.evidenceSamples.length === 0) {
      reasons.push('NO_DIRECT_EVIDENCE');
    }

    /**
     * A candidate with no observed occurrences is not supported by the
     * analyzed corpus, even when an NLP/AI enrichment step produced a
     * plausible title and one contextual sample. Keeping it as an
     * alternative is useful for diagnostics, but it must not be eligible
     * for final selection.
     */
    if (candidate.frequency <= 0) {
      reasons.push('NO_SUPPORTED_FREQUENCY');
    }

    if (evidenceReliabilityScore < MIN_SELECTION_RELIABILITY) {
      reasons.push('LOW_EVIDENCE_RELIABILITY');
    }

    const hasConcreteMultiSampleEvidence =
      candidate.evidenceSamples.length >= 2 &&
      directEvidenceRatio >= 0.6 &&
      evidenceQualityScore >= 0.5;
    const singleSampleQualityThreshold =
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST
        ? 0.5
        : 0.55;
    const singleSampleDirectRatioThreshold =
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST
        ? 0.75
        : 0.85;
    const hasStrongSingleSampleEvidence =
      candidate.evidenceSamples.length === 1 &&
      candidate.evidenceSamples[0].length >= 140 &&
      directEvidenceRatio >= singleSampleDirectRatioThreshold &&
      evidenceQualityScore >= singleSampleQualityThreshold;

    if (
      supportScore < 0.36 &&
      !hasConcreteMultiSampleEvidence &&
      !hasStrongSingleSampleEvidence
    ) {
      reasons.push('INSUFFICIENT_SUPPORT');
    }

    if (
      candidate.evidenceSamples.length <
        MIN_STANDARD_SELECTION_EVIDENCE_SAMPLES &&
      !hasStrongSingleSampleEvidence
    ) {
      reasons.push('INSUFFICIENT_EVIDENCE_COUNT');
    }

    if (
      nlpConfidence < LOW_NLP_CONFIDENCE_THRESHOLD &&
      evidenceReliabilityScore < MIN_LOW_CONFIDENCE_RELIABILITY &&
      !hasConcreteMultiSampleEvidence &&
      !hasStrongSingleSampleEvidence
    ) {
      reasons.push('LOW_CONFIDENCE_REQUIRES_STRONGER_EVIDENCE');
    }

    if (
      nlpConfidence < LOW_NLP_CONFIDENCE_THRESHOLD &&
      candidate.evidenceSamples.length < 2 &&
      candidate.frequency < 3 &&
      !hasStrongSingleSampleEvidence
    ) {
      reasons.push('SPARSE_EVIDENCE_UNDER_LOW_CONFIDENCE');
    }

    return reasons;
  }

  private calculateEvidenceReliability(
    candidate: NormalizedCandidate,
    evidenceScore: number,
    directEvidenceRatio: number,
    evidenceQualityScore: number,
  ): number {
    const frequencySupport = Math.min(candidate.frequency / 3, 1);
    const severitySupport = candidate.severity
      ? (SEVERITY_SCORES[candidate.severity] ?? 0.45)
      : 0.2;
    const sourceTrust =
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM
        ? 1
        : candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED
          ? 0.9
          : candidate.evidenceType ===
              IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST
            ? 0.78
            : 0.58;

    return Math.min(
      1,
      evidenceQualityScore * 0.38 +
        evidenceScore * 0.12 +
        directEvidenceRatio * 0.24 +
        frequencySupport * 0.1 +
        severitySupport * 0.06 +
        sourceTrust * 0.1,
    );
  }

  private calculateWeakEvidencePenalty(
    candidate: NormalizedCandidate,
    evidenceReliabilityScore: number,
  ): number {
    let penalty = 0;

    if (candidate.evidenceSamples.length <= 1) {
      penalty += 0.08;
    }
    if (candidate.frequency <= 0) {
      penalty += 0.08;
    }
    if (!candidate.severity) {
      penalty += 0.06;
    }
    if (
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY
    ) {
      penalty += 0.04;
    }
    if (evidenceReliabilityScore < 0.35) {
      penalty += 0.06;
    }

    return Math.min(0.28, penalty);
  }

  private calculateNovelty(
    candidate: NormalizedCandidate,
    previousIdeaTexts: readonly string[],
  ): number {
    const text = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();

    const genericPenalty =
      /dashboard|portal|management system|mobile app/iu.test(text) ? 0.2 : 0;
    const workflowBonus =
      /offline|proactive|predict|resilien|automation|cross-device|recovery/iu.test(
        text,
      )
        ? 0.12
        : 0;

    const candidateTokens = this.toSemanticTokenSet(text);
    let maxHistoricalSimilarity = 0;

    for (const previousIdeaText of previousIdeaTexts) {
      const similarity = this.jaccardSimilarity(
        candidateTokens,
        this.toSemanticTokenSet(previousIdeaText),
      );
      maxHistoricalSimilarity = Math.max(maxHistoricalSimilarity, similarity);
    }

    const familyRepeated = previousIdeaTexts.some((previousIdeaText) =>
      this.belongsToSameProblemFamily(text, previousIdeaText),
    );
    const historicalPenalty = Math.min(0.65, maxHistoricalSimilarity * 0.9);
    const familyPenalty = familyRepeated ? 0.42 : 0;

    return Math.max(
      0,
      Math.min(
        1,
        0.62 +
          workflowBonus -
          genericPenalty -
          historicalPenalty -
          familyPenalty,
      ),
    );
  }

  private belongsToSameProblemFamily(first: string, second: string): boolean {
    const families: readonly RegExp[] = [
      /authentication|account activation|login|sign in|verification|credential/iu,
      /data loss|synchroni[sz]|backup|recovery|missing history/iu,
      /navigation|interface|usability|back button|scroll|popup/iu,
      /cross-device|desktop|laptop|mobile-only|computer access/iu,
      /paywall|pricing|subscription|cost restriction|paid access/iu,
    ];

    return families.some((family) => family.test(first) && family.test(second));
  }

  private toSemanticTokenSet(value: string): ReadonlySet<string> {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'that',
      'this',
      'platform',
      'system',
      'application',
      'software',
      'users',
      'user',
      'academic',
      'education',
      'educational',
      'add',
      'advanced',
      'improve',
      'support',
      'feature',
      'request',
      'processing',
      'capabilities',
      'provide',
      'using',
      'nablus',
      'palestine',
    ]);

    return new Set(
      value
        .toLocaleLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !stopWords.has(token)),
    );
  }

  private jaccardSimilarity(
    first: ReadonlySet<string>,
    second: ReadonlySet<string>,
  ): number {
    if (first.size === 0 || second.size === 0) {
      return 0;
    }

    let intersection = 0;

    for (const token of first) {
      if (second.has(token)) {
        intersection += 1;
      }
    }

    const union = first.size + second.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private calculateBusinessValue(candidate: NormalizedCandidate): number {
    const severity = candidate.severity
      ? (SEVERITY_SCORES[candidate.severity] ?? 0.45)
      : 0.45;
    const frequency = Math.min(
      Math.log2(Math.max(candidate.frequency, 1) + 1) / 4,
      1,
    );
    const evidence = Math.min(
      candidate.evidenceSamples.length / MAX_EVIDENCE_SAMPLES,
      1,
    );

    return Math.min(1, severity * 0.4 + frequency * 0.35 + evidence * 0.25);
  }

  private calculateMarketGap(candidate: NormalizedCandidate): number {
    const text = [
      candidate.need,
      candidate.solutionArea,
      ...candidate.evidenceSamples,
    ]
      .filter(Boolean)
      .join(' ');
    const unmetNeedSignals = (
      text.match(
        /\b(?:need|wish|missing|lack|without|cannot|unable|no way)\b/giu,
      ) ?? []
    ).length;

    return Math.min(1, 0.42 + Math.min(unmetNeedSignals, 5) * 0.1);
  }

  private calculateCompetitionAdvantage(
    candidate: NormalizedCandidate,
  ): number {
    const text = [candidate.title, candidate.solutionArea]
      .filter(Boolean)
      .join(' ');
    const commodity =
      /dashboard|tracker|portal|directory|marketplace|chatbot/iu.test(text);
    const differentiated =
      /offline|resilien|cross-device|recovery|proactive|verification|automation/iu.test(
        text,
      );

    return Math.max(
      0,
      Math.min(1, 0.5 + (differentiated ? 0.22 : 0) - (commodity ? 0.18 : 0)),
    );
  }

  private calculateTechnicalRisk(candidate: NormalizedCandidate): number {
    const text = [candidate.title, candidate.problem, candidate.solutionArea]
      .filter(Boolean)
      .join(' ');
    const highRisk =
      /blockchain|biometric|medical diagnosis|autonomous|real-time prediction/iu.test(
        text,
      );
    const integrationRisk =
      /integration|synchronization|cross-device|authentication/iu.test(text);

    return highRisk ? 0.78 : integrationRisk ? 0.58 : 0.38;
  }

  private canonicalizeOpportunityTitle(value: string): string {
    const normalized = value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

    if (
      /document|download|syllabus|file access|broken link/iu.test(normalized)
    ) {
      return 'Document Access and Download Failures';
    }

    if (
      /data loss|synchronization|sync|recovery|missing history/iu.test(
        normalized,
      )
    ) {
      return 'Data Loss and Synchronization Failures';
    }

    if (
      /cross-device|cross device|desktop|laptop|computer|mobile only/iu.test(
        normalized,
      )
    ) {
      return 'Cross-Device Access Barriers';
    }

    if (
      /activation|verification|authentication|login|sign in|account/iu.test(
        normalized,
      )
    ) {
      return 'Account Activation and Login Failures';
    }

    if (
      /navigation|interface|usability|back button|scroll|popup/iu.test(
        normalized,
      )
    ) {
      return 'Navigation and Interface Failures';
    }

    if (/cost|paywall|paid|price|subscription/iu.test(normalized)) {
      return 'High Cost or Paywall Restrictions';
    }

    if (
      /crash|instability|reliability|freeze|generic error|glitch/iu.test(
        normalized,
      )
    ) {
      return 'Application Reliability and Crash Failures';
    }

    if (
      /cyberchef|magic search|algorithm discovery|algorithm guessing|recipe generation|transformation recipe|processing support/iu.test(
        normalized,
      )
    ) {
      return 'AI-Assisted Algorithm Discovery and Recipe Generation';
    }

    if (
      /agent orchestration|agent registration|auto-discovery|routing requests|multi-agent/iu.test(
        normalized,
      )
    ) {
      return 'Interoperable AI Agent Orchestration';
    }

    return value.replace(/\s+/gu, ' ').trim();
  }

  private isEvidenceRelevantToTitle(title: string, evidence: string): boolean {
    const normalizedTitle = title.toLocaleLowerCase();

    if (/document|download/iu.test(normalizedTitle)) {
      return /\b(?:document|download|syllabus|file|attachment|link|null error)\b/iu.test(
        evidence,
      );
    }

    if (/data loss|synchronization/iu.test(normalizedTitle)) {
      return /\b(?:data|history|classes|progress|sync|lost|missing|gone|deleted)\b/iu.test(
        evidence,
      );
    }

    if (/cross-device/iu.test(normalizedTitle)) {
      return /\b(?:desktop|laptop|computer|pc|mobile only|ios|android)\b/iu.test(
        evidence,
      );
    }

    if (/activation|login|account/iu.test(normalizedTitle)) {
      return /\b(?:activation|verification|email|code|otp|login|sign in|account)\b/iu.test(
        evidence,
      );
    }

    if (/navigation|interface/iu.test(normalizedTitle)) {
      return /\b(?:navigate|navigation|interface|back button|scroll|popup|tabs?|course selection)\b/iu.test(
        evidence,
      );
    }

    if (/cost|paywall/iu.test(normalizedTitle)) {
      return /\b(?:cost|price|paywall|paid|pay|subscription|limited tasks|limited features)\b/iu.test(
        evidence,
      );
    }

    if (/reliability|crash/iu.test(normalizedTitle)) {
      return this.hasConcreteRuntimeFailureSignal(evidence);
    }

    return this.hasMeaningfulSemanticOverlap(title, evidence);
  }

  private deriveFeatureRequestTitle(
    candidate: NormalizedCandidate,
    evidenceSamples: readonly string[],
  ): string | null {
    const text = [
      candidate.title,
      candidate.solutionArea,
      candidate.need,
      ...evidenceSamples,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    if (
      /(?:ai|artificial intelligence|llm).{0,160}(?:local|browser|on-device|privacy|external server|consent)|(?:sensitive data|user-provided data).{0,140}(?:local|browser|external service|consent)/iu.test(
        text,
      )
    ) {
      return 'Privacy-Preserving Local AI Processing';
    }

    if (
      /(?:algorithm guessing|recipe generation|magic feature|decode|encoding|cyberchef)/iu.test(
        text,
      )
    ) {
      return 'AI-Assisted Algorithm Discovery and Recipe Generation';
    }

    const explicitTitle = candidate.title.replace(/\s+/gu, ' ').trim();

    if (
      explicitTitle &&
      !GENERIC_LABELS.has(explicitTitle.toLowerCase()) &&
      explicitTitle.split(/\s+/u).length >= 3
    ) {
      return explicitTitle;
    }

    return null;
  }

  /**
   * Determines whether an evidence sample is safe to attach to an opportunity.
   *
   * Acceptance paths:
   * - The title and evidence share a known concrete problem family.
   * - The structured candidate context and evidence share a known family.
   * - The evidence has strong semantic overlap with both title and context.
   * - A direct complaint or feature-request signal has strong overlap with at
   *   least one structured context, allowing valid paraphrases to survive.
   */
  private isEvidenceAcceptableForOpportunity(
    candidate: NormalizedCandidate,
    title: string,
    evidence: string,
  ): boolean {
    const candidateContext = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');

    const titleFamilyMatch = this.hasSharedEvidenceFamily(title, evidence);
    const candidateFamilyMatch = this.hasSharedEvidenceFamily(
      candidateContext,
      evidence,
    );
    const titleSemanticMatch = this.isEvidenceRelevantToTitle(title, evidence);
    const candidateSemanticMatch = this.isEvidenceRelevantToCandidate(
      candidate,
      evidence,
    );
    const structuredDirectSignal =
      this.hasDirectComplaintSignal(evidence) &&
      (titleSemanticMatch || candidateSemanticMatch);
    const relevanceScore = this.calculateEvidenceRelevanceScore(
      candidate,
      title,
      evidence,
    );

    const requiresConcreteReliabilitySignal =
      /application reliability|crash failures/iu.test(title);

    if (
      requiresConcreteReliabilitySignal &&
      !this.hasConcreteRuntimeFailureSignal(evidence)
    ) {
      return false;
    }

    return (
      this.meetsEvidenceRelevanceThreshold(title, relevanceScore) &&
      (titleFamilyMatch ||
        candidateFamilyMatch ||
        (titleSemanticMatch && candidateSemanticMatch) ||
        structuredDirectSignal)
    );
  }

  /**
   * Scores the semantic connection between one evidence sample and the exact
   * opportunity. This prevents broad families such as "application errors"
   * from accepting unrelated programming questions merely because both texts
   * contain generic words such as error, bug, or application.
   */
  private calculateEvidenceRelevanceScore(
    candidate: NormalizedCandidate,
    title: string,
    evidence: string,
  ): number {
    const candidateContext = [
      title,
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const contextTokens = this.toSemanticTokenSet(candidateContext);
    const evidenceTokens = this.toSemanticTokenSet(evidence);
    const lexicalSimilarity = this.jaccardSimilarity(
      contextTokens,
      evidenceTokens,
    );
    const titleMatch = this.isEvidenceRelevantToTitle(title, evidence) ? 1 : 0;
    const candidateMatch = this.isEvidenceRelevantToCandidateTokens(
      candidate,
      evidence,
    )
      ? 1
      : 0;
    const familyMatch = this.hasSharedEvidenceFamily(candidateContext, evidence)
      ? 1
      : 0;
    const directSignal = this.hasDirectComplaintSignal(evidence) ? 1 : 0;
    const qualityScore = this.calculateEvidenceQuality(evidence);

    return Math.min(
      1,
      lexicalSimilarity * 0.36 +
        titleMatch * 0.2 +
        candidateMatch * 0.16 +
        familyMatch * 0.1 +
        directSignal * 0.08 +
        qualityScore * 0.1,
    );
  }

  private meetsEvidenceRelevanceThreshold(
    title: string,
    relevanceScore: number,
  ): boolean {
    const isGenericReliabilityOpportunity =
      /application reliability|crash failures/iu.test(title);

    return (
      relevanceScore >=
      (isGenericReliabilityOpportunity
        ? MIN_GENERIC_RELIABILITY_RELEVANCE_SCORE
        : MIN_EVIDENCE_RELEVANCE_SCORE)
    );
  }

  /**
   * Rejects generic programming questions that only contain words such as
   * "error" or "module". Reliability evidence must describe an observable
   * runtime failure, state loss, stalled execution, or an application that is
   * unusable in practice.
   */
  private hasConcreteRuntimeFailureSignal(evidence: string): boolean {
    const normalized = evidence.toLowerCase();

    const explicitRuntimeFailure =
      /\b(?:crash(?:ed|es|ing)?|freeze(?:s|ing|n)?|hang(?:s|ing)?|stuck|unresponsive|terminated|unexpectedly closes?|won['’]?t open|doesn['’]?t start|keeps? restarting|infinite loop|lost progress|state loss|session (?:lost|expired|stuck)|rollback|restore failed|data (?:lost|missing)|memory spike|out of memory|unhandled exception|runtime failure)\b/iu.test(
        normalized,
      );

    /*
     * A user may report observable application defects as "bugs" or
     * "errors" without using the word "crash". Accept those reports only
     * when the text clearly refers to an application in use and contains a
     * concrete defect/remediation statement. This remains stricter than a
     * generic programming question containing the word "error".
     */
    const concreteApplicationDefect =
      /\b(?:app|application|software|platform)\b/iu.test(normalized) &&
      /\b(?:bugs?|errors?|glitches?|unstable|laggy|fails?)\b/iu.test(
        normalized,
      ) &&
      /\b(?:use|using|user|users|years?|experience|improve|solve|fix|affect|disrupt)\b/iu.test(
        normalized,
      );

    const genericProgrammingQuestion =
      /\b(?:import(?:ing)?|module|parent directory|function|syntax|compile|compiler|package|library|class|variable|type error|stack overflow question)\b/iu.test(
        normalized,
      );

    return (
      (explicitRuntimeFailure || concreteApplicationDefect) &&
      !genericProgrammingQuestion
    );
  }

  private isEvidenceRelevantToCandidateTokens(
    candidate: NormalizedCandidate,
    evidence: string,
  ): boolean {
    const contextTokens = this.toSemanticTokenSet(
      [
        candidate.title,
        candidate.problem,
        candidate.need,
        candidate.solutionArea,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    );
    const evidenceTokens = this.toSemanticTokenSet(evidence);

    if (contextTokens.size === 0) {
      return false;
    }

    let sharedTokens = 0;

    for (const token of contextTokens) {
      if (evidenceTokens.has(token)) {
        sharedTokens += 1;
      }
    }

    const minimumSharedTokens = contextTokens.size <= 3 ? 1 : 2;
    const overlapRatio = sharedTokens / Math.max(contextTokens.size, 1);

    return sharedTokens >= minimumSharedTokens && overlapRatio >= 0.2;
  }

  private isEvidenceRelevantToCandidate(
    candidate: NormalizedCandidate,
    evidence: string,
  ): boolean {
    const candidateContext = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      this.hasSharedEvidenceFamily(candidateContext, evidence) ||
      this.isEvidenceRelevantToCandidateTokens(candidate, evidence)
    );
  }

  /**
   * Checks whether two texts refer to the same concrete problem or feature
   * family. Family matching prevents a generic shared word such as "support"
   * or "application" from making unrelated evidence appear relevant.
   */
  private hasSharedEvidenceFamily(first: string, second: string): boolean {
    const families: readonly RegExp[] = [
      /crash|freeze|error|bug|failure|instability|reliability|glitch/iu,
      /sync|data loss|missing history|restore|recovery|deleted|backup/iu,
      /paywall|price|subscription|purchase|payment|advert|money/iu,
      /privacy|local processing|browser execution|on-device|external server|external service|consent|data sovereignty/iu,
      /algorithm|decode|encode|recipe|magic feature|cyberchef|transformation/iu,
      /login|account|activation|verification|authentication|otp/iu,
      /navigation|interface|directions|usability|scroll|button/iu,
      /agent orchestration|agent registration|auto-discovery|routing requests|multi-agent/iu,
    ];

    return families.some((family) => family.test(first) && family.test(second));
  }

  /**
   * Requires meaningful lexical overlap when no known problem family applies.
   * This is intentionally stricter than a single-token match because generic
   * words frequently occur across unrelated technical discussions.
   */
  private hasMeaningfulSemanticOverlap(
    context: string,
    evidence: string,
  ): boolean {
    const contextTokens = this.toSemanticTokenSet(context);
    const evidenceTokens = this.toSemanticTokenSet(evidence);

    if (contextTokens.size === 0 || evidenceTokens.size === 0) {
      return false;
    }

    let sharedTokens = 0;

    for (const token of contextTokens) {
      if (evidenceTokens.has(token)) {
        sharedTokens += 1;
      }
    }

    const requiredSharedTokens = contextTokens.size <= 3 ? 1 : 2;
    const overlapRatio = sharedTokens / contextTokens.size;

    return sharedTokens >= requiredSharedTokens && overlapRatio >= 0.2;
  }

  /**
   * Removes exact and quote-prefixed duplicates while preserving the highest
   * quality representative of each evidence statement.
   */
  private deduplicateEvidenceSamples(samples: readonly string[]): string[] {
    const strongestByIdentity = new Map<string, string>();

    for (const sample of samples) {
      const identity = sample
        .toLocaleLowerCase()
        .replace(/^(?:>\s*)+/u, '')
        .replace(/@[\p{L}\p{N}_-]+/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

      if (!identity) {
        continue;
      }

      const current = strongestByIdentity.get(identity);

      if (
        !current ||
        this.calculateEvidenceQuality(sample) >
          this.calculateEvidenceQuality(current)
      ) {
        strongestByIdentity.set(identity, sample);
      }
    }

    return [...strongestByIdentity.values()].sort(
      (first, second) =>
        this.calculateEvidenceQuality(second) -
          this.calculateEvidenceQuality(first) || second.length - first.length,
    );
  }

  private deriveConcreteTitle(
    evidenceSamples: readonly string[],
  ): string | null {
    const text = evidenceSamples.join(' ').toLowerCase();

    if (this.hasCrossDeviceAccessFailure(text)) {
      return 'Cross-Device Access Barriers';
    }

    if (
      /(?:activation|verification|email|code|otp).{0,100}(?:never|not|fail)/iu.test(
        text,
      )
    ) {
      return 'Reliable Account Activation';
    }

    if (
      /(?:data|history|classes|progress).{0,80}(?:gone|lost|missing|deleted|sync)/iu.test(
        text,
      )
    ) {
      return 'Data Loss and Synchronization Failures';
    }

    if (
      /(?:confusing|hard|difficult).{0,40}(?:navigate|interface|use)/iu.test(
        text,
      )
    ) {
      return 'Navigation and Interface Failures';
    }

    if (/(?:crash|freeze|broken|bug|error)/iu.test(text)) {
      return 'Application Reliability and Crash Failures';
    }

    if (
      /(?:paywall|subscription|requires? payment|have to pay|gotta pay|paid feature|limited tasks?|limited features?)/iu.test(
        text,
      )
    ) {
      return 'High Cost or Paywall Restrictions';
    }

    if (
      /(?:stops?|cuts? off|ends?).{0,40}(?:mid[- ]sentence|before (?:finishing|completing|providing))|(?:only getting part|incomplete (?:answer|response|output|information)|missing the rest)/iu.test(
        text,
      )
    ) {
      return 'Complete and Uninterrupted AI Responses';
    }

    if (
      /(?:ai|artificial intelligence).{0,120}(?:local|on-device|without external servers|explicit user consent)|(?:data|sensitive data).{0,100}(?:external servers|user consent|local processing)/iu.test(
        text,
      )
    ) {
      return 'Privacy-Preserving Local AI Processing';
    }

    if (
      /(?:protocol interoperability|agent orchestration|distributed ai agents?|cloud-native ai agents?)/iu.test(
        text,
      )
    ) {
      return 'Interoperable AI Agent Orchestration';
    }

    if (
      /(?:لا يمكن|ما بقدر).{0,60}(?:كمبيوتر|لابتوب)|(?:الهاتف فقط)/iu.test(text)
    ) {
      return 'الوصول إلى التعلم عبر الأجهزة';
    }

    if (
      /(?:رسالة|رمز).{0,40}(?:تفعيل|تحقق).{0,40}(?:لم يصل|ما وصل)/iu.test(text)
    ) {
      return 'تفعيل حسابات موثوق';
    }

    return null;
  }

  private hasCrossDeviceAccessFailure(value: string): boolean {
    const hasTargetDevice = /\b(?:computer|desktop|laptop|pc)\b/iu.test(value);
    const hasAccessAction =
      /\b(?:download(?:ed|ing)?|install(?:ed|ing)?|access(?:ed|ing)?|use|using|run|open)\b/iu.test(
        value,
      );
    const hasFailureSignal =
      /\b(?:(?:can(?:not|['’]?t)|can\s+not)|cannot|could(?:n['’]?t| not)|unable to|not available|does(?:n['’]?t| not) work|won['’]?t work|fails? to)\b/iu.test(
        value,
      );

    return (
      /\bmobile[- ]only\b/iu.test(value) ||
      (hasTargetDevice && hasAccessAction && hasFailureSignal)
    );
  }

  private calculateDirectEvidenceRatio(candidate: NormalizedCandidate): number {
    if (candidate.evidenceSamples.length === 0) {
      return 0;
    }

    const direct = candidate.evidenceSamples.filter(
      (sample) =>
        this.hasDirectComplaintSignal(sample) ||
        this.isAcceptedCommunityAiEvidence(candidate, sample),
    ).length;

    return direct / candidate.evidenceSamples.length;
  }

  private calculateAverageEvidenceQuality(
    candidate: NormalizedCandidate,
  ): number {
    if (candidate.evidenceSamples.length === 0) {
      return 0;
    }

    const scores = candidate.evidenceSamples.map((sample) =>
      this.calculateEvidenceQuality(sample),
    );

    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  /** Scores diagnostic specificity so vague sentiment cannot outrank concrete failures. */
  private calculateEvidenceQuality(value: string): number {
    const normalized = value.replace(/\s+/gu, ' ').trim();

    if (
      !normalized ||
      VAGUE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      return 0.15;
    }

    let score = 0.3;

    if (
      CONCRETE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      score += 0.45;
    }
    if (
      /\b(?:when|while|after|before|because|during|every\s+time)\b/iu.test(
        normalized,
      )
    ) {
      score += 0.1;
    }
    if (
      /\b(?:data|plan|field|crop|water|device|account|screen|button|record|command|privacy|consent|algorithm|recipe|browser|server)\b/iu.test(
        normalized,
      )
    ) {
      score += 0.08;
    }
    if (
      /\b(?:without explicit consent|does not transmit|never be sent|runs? locally|entirely within the browser|unable to determine|limited to the simplest cases)\b/iu.test(
        normalized,
      )
    ) {
      score += 0.12;
    }
    if (normalized.split(/\s+/u).length >= 8) {
      score += 0.07;
    }

    return Math.min(1, score);
  }

  private calculateSpecificity(candidate: NormalizedCandidate): number {
    const titleWords = candidate.title.split(/\s+/u).filter(Boolean).length;
    const workflowBonus =
      /download|upload|navigation|login|activation|access|assignment|grade|document|sync|data|notification|recovery|payment/iu.test(
        [candidate.title, ...candidate.evidenceSamples].join(' '),
      )
        ? 0.3
        : 0;

    return Math.min(1, 0.35 + Math.min(titleWords / 8, 0.35) + workflowBonus);
  }

  private calculateFeasibility(candidate: NormalizedCandidate): number {
    const text = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    return /app|api|document|workflow|platform|mobile|web|data|analytics|automation|integration|notification|access|search|sync|authentication|recovery/iu.test(
      text,
    )
      ? 0.88
      : 0.65;
  }

  private calculateLocalRelevance(
    candidate: NormalizedCandidate,
    locationTerms: readonly string[],
  ): number {
    const searchableText = [candidate.title, ...candidate.evidenceSamples]
      .join(' ')
      .toLowerCase();
    const normalizedTerms = locationTerms
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);

    if (normalizedTerms.length === 0) {
      return 0.5;
    }

    return normalizedTerms.some((term) => searchableText.includes(term))
      ? 1
      : 0.25;
  }

  private buildQualityWarnings(
    nlp: IdeaGenerationNlpContext,
    ranked: readonly RankedIdeaOpportunity[],
    evidenceCoverage: number,
  ): string[] {
    const warnings: string[] = [];

    const confidence = nlp.confidence ?? 0;

    if (confidence < 0.65) {
      warnings.push(
        `NLP confidence is ${(confidence * 100).toFixed(1)}%; opportunity claims must remain evidence-qualified and should not be presented as market-wide facts.`,
      );
    }

    if (nlp.totalTextsAnalyzed < 80) {
      warnings.push(
        `Only ${nlp.totalTextsAnalyzed} texts were analyzed; market-wide conclusions remain preliminary.`,
      );
    }

    if (evidenceCoverage < 0.6) {
      warnings.push(
        'Several ranked opportunities lack representative evidence samples.',
      );
    }

    if (ranked[0].evidenceReliabilityScore < 0.5) {
      warnings.push(
        `The selected opportunity has limited evidence reliability (${(ranked[0].evidenceReliabilityScore * 100).toFixed(1)}/100).`,
      );
    }

    if (!ranked[0].selectionEligible) {
      warnings.push(
        `No opportunity passed the strict selection gate; the best available fallback was used (${ranked[0].disqualificationReasons.join(', ')}).`,
      );
    }

    if (ranked[0].supportScore < 0.6) {
      warnings.push(
        `The selected opportunity has moderate support (${(ranked[0].supportScore * 100).toFixed(1)}/100); additional evidence collection is recommended.`,
      );
    }

    if (ranked[0].localRelevanceScore < 1) {
      warnings.push(
        'The selected location is a deployment target, not a location proven directly by the collected evidence.',
      );
    }

    return warnings;
  }

  private hasDirectComplaintSignal(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();

    if (!normalized || this.isNegatedComplaint(normalized)) {
      return false;
    }

    return DIRECT_COMPLAINT_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    );
  }

  /**
   * Rejects statements that merely contain a complaint keyword while explicitly
   * denying the problem, for example: "education is not broken".
   */
  private isNegatedComplaint(value: string): boolean {
    return [
      /\b(?:is|are|was|were)\s+not\s+(?:broken|failing|faulty|bad|unstable)\b/iu,
      /\b(?:not|never)\s+(?:a|an|the)?\s*(?:problem|issue|failure|bug|error)\b/iu,
      /\b(?:works?|working)\s+(?:fine|well|properly)\b/iu,
      /(?:ليس|ليست|مش|مو)\s+(?:معطل|مشكلة|خطأ|سيئ)/iu,
    ].some((pattern) => pattern.test(value));
  }

  private isNonDiagnosticEvidence(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();

    if (!normalized) {
      return true;
    }

    if (
      NON_DIAGNOSTIC_EVIDENCE_PATTERNS.some((pattern) =>
        pattern.test(normalized),
      )
    ) {
      return true;
    }

    const wordCount = normalized.split(/\s+/u).length;
    const hasConcreteSignal = CONCRETE_EVIDENCE_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    );
    const hasOnlyGenericFailureSignal =
      wordCount < 8 &&
      /\b(?:error|bug|issue|problem|failure|wrong)\b/iu.test(normalized) &&
      !/\b(?:app|application|login|account|session|sync|payment|subscription|download|upload|save|load|crash|freeze|glitch|server|network|model|response|history|data)\b/iu.test(
        normalized,
      );

    if (hasOnlyGenericFailureSignal) {
      return true;
    }
    const hasFeatureRequestDetail =
      /(?:feature request|describe the solution|would like|should add|needs? support|allow users? to)/iu.test(
        normalized,
      );

    return wordCount < 5 && !hasConcreteSignal && !hasFeatureRequestDetail;
  }

  private isPromotionalOnlyEvidence(value: string): boolean {
    const promotionalSignals = PROMOTIONAL_PATTERNS.filter((pattern) =>
      pattern.test(value),
    ).length;

    return (
      value.length >= 900 &&
      promotionalSignals >= 2 &&
      !this.hasDirectComplaintSignal(value)
    );
  }

  private normalizeEvidenceSample(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();

    if (!normalized) {
      return '';
    }

    return normalized.length <= MAX_EVIDENCE_SAMPLE_LENGTH
      ? normalized
      : `${normalized.slice(0, MAX_EVIDENCE_SAMPLE_LENGTH - 1).trimEnd()}…`;
  }

  private isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readString(value: Prisma.JsonValue | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized || null;
  }

  private readNumber(value: Prisma.JsonValue | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 0;
  }

  private readStringArray(value: Prisma.JsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, MAX_EVIDENCE_SAMPLES);
  }

  private round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
  }
}
