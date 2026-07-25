import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  IDEA_OPPORTUNITY_EVIDENCE_TYPES,
  type IdeaOpportunityEvidenceType,
  type IdeaOpportunityRanking,
  type RankedIdeaOpportunity,
} from '../types/idea-opportunity-ranking.type';
import type { IdeaGenerationNlpContext } from '../types/idea-generation-context.type';

const MAX_EVIDENCE_SAMPLES = 5;
const MAX_EVIDENCE_SAMPLE_LENGTH = 700;
const MAX_RANKED_OPPORTUNITIES = 8;

/** Labels that are too generic to be selected without concrete evidence. */
const GENERIC_LABELS = new Set([
  'app',
  'application',
  'available',
  'challenge',
  'difficulty',
  'feature',
  'features',
  'information',
  'issue',
  'need',
  'platform',
  'problem',
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
  /(?:غير مفيد|لا يعمل|ما بشتغل|لا أستطيع|لا يمكن|لم يصل|فقدت|اختفت|تعطل|خطأ|صعب التنقل|واجهة مربكة)/iu,
];

/** Promotional descriptions that should not be accepted as problem evidence. */
const PROMOTIONAL_PATTERNS: readonly RegExp[] = [
  /\b(?:why choose|join millions|trusted by|privacy policy|membership details|download .* today|proven results|full curriculum)\b/iu,
  /\b(?:available on|personalized learning|detailed features|official app)\b/iu,
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
 * Converts persisted NLP output into deterministic evidence-aware opportunity
 * ranking.
 *
 * The ranking rejects generic labels and promotional-only evidence, derives a
 * concrete workflow title from direct complaints when possible, and prevents a
 * low-frequency product-description word such as "Difficulty" from becoming
 * the selected opportunity.
 *
 * @author Malak
 */
@Injectable()
export class IdeaOpportunityRankingService {
  /** Ranks problems, needs, feature requests, and NLP opportunities. */
  rank(
    nlp: IdeaGenerationNlpContext,
    locationTerms: readonly string[],
  ): IdeaOpportunityRanking {
    const extractedCandidates = [
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

    const ranked = consolidatedCandidates
      .map((candidate) => this.scoreCandidate(candidate, locationTerms))
      .sort((first, second) => {
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
      throw new Error(
        'NLP analysis did not contain a concrete evidence-backed opportunity.',
      );
    }

    const evidenceBacked = ranked.filter(
      (candidate) => candidate.evidenceSamples.length > 0,
    ).length;
    const evidenceCoverage = this.round(
      evidenceBacked / Math.max(ranked.length, 1),
    );

    return {
      selected: ranked[0],
      alternatives: ranked.slice(1),
      evaluatedCount: extractedCandidates.length,
      evidenceCoverage,
      selectionReason: this.buildSelectionReason(ranked[0], ranked[1]),
      qualityWarnings: this.buildQualityWarnings(nlp, ranked, evidenceCoverage),
    };
  }

  /**
   * Explains the selected opportunity using only deterministic score inputs.
   */
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

  /** Extracts array-shaped NLP values into candidates. */
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
      const title =
        this.readString(entry.title) ??
        problem ??
        need ??
        solutionArea ??
        this.readString(entry.topic) ??
        this.readString(entry.feature) ??
        this.readString(entry.request) ??
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

  /** Normalizes a candidate and rejects unsupported evidence. */
  private normalizeCandidate(
    candidate: NormalizedCandidate,
  ): NormalizedCandidate | null {
    const normalizedEvidence = candidate.evidenceSamples
      .map((sample) => this.normalizeEvidenceSample(sample))
      .filter(Boolean)
      .filter((sample) => !this.isPromotionalOnlyEvidence(sample));

    const directEvidence = normalizedEvidence.filter((sample) =>
      this.hasDirectComplaintSignal(sample),
    );
    const originalTitle = candidate.title.replace(/\s+/gu, ' ').trim();
    const normalizedTitle = originalTitle.toLowerCase();
    const derivedTitle = this.deriveConcreteTitle(directEvidence);
    const tentativeTitle =
      GENERIC_LABELS.has(normalizedTitle) ||
      originalTitle.split(/\s+/u).length < 2
        ? derivedTitle
        : originalTitle;
    const finalTitle = tentativeTitle
      ? this.canonicalizeOpportunityTitle(tentativeTitle)
      : null;

    if (!finalTitle) {
      return null;
    }

    const relevantEvidence = normalizedEvidence.filter((sample) =>
      this.isEvidenceRelevantToTitle(finalTitle, sample),
    );
    const evidenceSamples =
      relevantEvidence.length > 0 ? relevantEvidence : directEvidence;

    const requiresDirectEvidence =
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM ||
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED;

    if (requiresDirectEvidence && directEvidence.length === 0) {
      return null;
    }

    if (
      candidate.evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM &&
      candidate.severity === 'LOW' &&
      candidate.frequency < 2 &&
      directEvidence.length === 0
    ) {
      return null;
    }

    return {
      ...candidate,
      title: finalTitle,
      problem:
        candidate.problem &&
        !GENERIC_LABELS.has(candidate.problem.toLowerCase())
          ? candidate.problem
          : finalTitle,
      need:
        candidate.need && !GENERIC_LABELS.has(candidate.need.toLowerCase())
          ? candidate.need
          : null,
      evidenceSamples: evidenceSamples.slice(0, MAX_EVIDENCE_SAMPLES),
    };
  }

  /**
   * Merges duplicate problem/need/opportunity records describing the same
   * workflow so one issue cannot occupy multiple ranking positions.
   */
  private consolidateEquivalentCandidates(
    candidates: readonly NormalizedCandidate[],
  ): NormalizedCandidate[] {
    const groups = new Map<string, NormalizedCandidate>();

    for (const candidate of candidates) {
      const key = this.canonicalizeOpportunityTitle(candidate.title)
        .toLocaleLowerCase()
        .replace(/\s+/gu, ' ')
        .trim();
      const current = groups.get(key);

      if (!current) {
        groups.set(key, candidate);
        continue;
      }

      const preferred = this.selectStrongerCandidate(current, candidate);
      const secondary = preferred === current ? candidate : current;
      const evidenceSamples = Array.from(
        new Set([...preferred.evidenceSamples, ...secondary.evidenceSamples]),
      ).slice(0, MAX_EVIDENCE_SAMPLES);

      groups.set(key, {
        ...preferred,
        problem: preferred.problem ?? secondary.problem,
        need: preferred.need ?? secondary.need,
        solutionArea: preferred.solutionArea ?? secondary.solutionArea,
        frequency: Math.max(preferred.frequency, secondary.frequency),
        severity: this.selectHigherSeverity(
          preferred.severity,
          secondary.severity,
        ),
        evidenceSamples,
        sourceIndex: Math.min(preferred.sourceIndex, secondary.sourceIndex),
      });
    }

    return [...groups.values()];
  }

  /** Selects the more authoritative evidence record for a merged title. */
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

  /** Returns the highest available severity without inventing a value. */
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

  /** Applies deterministic weighted scoring. */
  private scoreCandidate(
    candidate: NormalizedCandidate,
    locationTerms: readonly string[],
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
    const specificityScore = this.calculateSpecificity(candidate);
    const feasibilityScore = this.calculateFeasibility(candidate);
    const localRelevanceScore = this.calculateLocalRelevance(
      candidate,
      locationTerms,
    );
    const evidenceTypeScore = EVIDENCE_TYPE_SCORES[candidate.evidenceType];
    const noveltyScore = this.calculateNovelty(candidate);
    const businessValueScore = this.calculateBusinessValue(candidate);
    const marketGapScore = this.calculateMarketGap(candidate);
    const competitionScore = this.calculateCompetitionAdvantage(candidate);
    const technicalRiskScore = this.calculateTechnicalRisk(candidate);

    const finalScore = this.round(
      frequencyScore * 0.1 +
        severityScore * 0.1 +
        evidenceScore * 0.13 +
        directEvidenceRatio * 0.14 +
        specificityScore * 0.11 +
        feasibilityScore * 0.08 +
        localRelevanceScore * 0.04 +
        evidenceTypeScore * 0.04 +
        noveltyScore * 0.07 +
        businessValueScore * 0.08 +
        marketGapScore * 0.05 +
        competitionScore * 0.03 +
        (1 - technicalRiskScore) * 0.03,
    );

    return {
      ...candidate,
      frequencyScore: this.round(frequencyScore),
      severityScore: this.round(severityScore),
      evidenceScore: this.round(evidenceScore),
      specificityScore: this.round(specificityScore),
      feasibilityScore: this.round(feasibilityScore),
      localRelevanceScore: this.round(localRelevanceScore),
      noveltyScore: this.round(noveltyScore),
      businessValueScore: this.round(businessValueScore),
      marketGapScore: this.round(marketGapScore),
      competitionScore: this.round(competitionScore),
      technicalRiskScore: this.round(technicalRiskScore),
      finalScore,
    };
  }

  /** Estimates useful novelty from specificity and solution direction. */
  private calculateNovelty(candidate: NormalizedCandidate): number {
    const text = [candidate.title, candidate.problem, candidate.need, candidate.solutionArea]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    const genericPenalty = /dashboard|portal|management system|mobile app/iu.test(text)
      ? 0.2
      : 0;
    const workflowBonus = /offline|proactive|predict|resilien|automation|cross-device|recovery/iu.test(text)
      ? 0.18
      : 0;

    return Math.max(0, Math.min(1, 0.58 + workflowBonus - genericPenalty));
  }

  /** Estimates the practical value of solving the observed workflow problem. */
  private calculateBusinessValue(candidate: NormalizedCandidate): number {
    const severity = candidate.severity
      ? (SEVERITY_SCORES[candidate.severity] ?? 0.45)
      : 0.45;
    const frequency = Math.min(Math.log2(Math.max(candidate.frequency, 1) + 1) / 4, 1);
    const evidence = Math.min(candidate.evidenceSamples.length / MAX_EVIDENCE_SAMPLES, 1);

    return Math.min(1, severity * 0.4 + frequency * 0.35 + evidence * 0.25);
  }

  /** Uses unmet-need language as a transparent proxy for market gap. */
  private calculateMarketGap(candidate: NormalizedCandidate): number {
    const text = [candidate.need, candidate.solutionArea, ...candidate.evidenceSamples]
      .filter(Boolean)
      .join(' ');
    const unmetNeedSignals = (text.match(/(?:need|wish|missing|lack|without|cannot|unable|no way)/giu) ?? []).length;

    return Math.min(1, 0.42 + Math.min(unmetNeedSignals, 5) * 0.1);
  }

  /** Scores differentiation against obvious commodity solution patterns. */
  private calculateCompetitionAdvantage(candidate: NormalizedCandidate): number {
    const text = [candidate.title, candidate.solutionArea].filter(Boolean).join(' ');
    const commodity = /dashboard|tracker|portal|directory|marketplace|chatbot/iu.test(text);
    const differentiated = /offline|resilien|cross-device|recovery|proactive|verification|automation/iu.test(text);

    return Math.max(0, Math.min(1, 0.5 + (differentiated ? 0.22 : 0) - (commodity ? 0.18 : 0)));
  }

  /** Returns risk, where zero is low risk and one is high risk. */
  private calculateTechnicalRisk(candidate: NormalizedCandidate): number {
    const text = [candidate.title, candidate.problem, candidate.solutionArea]
      .filter(Boolean)
      .join(' ');
    const highRisk = /blockchain|biometric|medical diagnosis|autonomous|real-time prediction/iu.test(text);
    const integrationRisk = /integration|synchronization|cross-device|authentication/iu.test(text);

    return highRisk ? 0.78 : integrationRisk ? 0.58 : 0.38;
  }

  /** Maps equivalent NLP and AI labels to one stable opportunity title. */
  private canonicalizeOpportunityTitle(value: string): string {
    const normalized = value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

    // Match concrete workflows before generic terms such as "failure".
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

    return value.replace(/\s+/gu, ' ').trim();
  }

  /** Keeps only evidence sentences that support the candidate category. */
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
      return /\b(?:crash|freeze|error|bug|glitch|looping|doesn['’]?t work|won['’]?t open)\b/iu.test(
        evidence,
      );
    }

    return this.hasDirectComplaintSignal(evidence);
  }

  /** Derives a concrete opportunity title from complaint evidence. */
  private deriveConcreteTitle(
    evidenceSamples: readonly string[],
  ): string | null {
    const text = evidenceSamples.join(' ').toLowerCase();

    if (this.hasCrossDeviceAccessFailure(text)) {
      return 'Cross-Device Learning Access';
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
      return 'Learning Data Recovery and Sync';
    }

    if (
      /(?:confusing|hard|difficult).{0,40}(?:navigate|interface|use)/iu.test(
        text,
      )
    ) {
      return 'Accessible Learning Navigation';
    }

    if (/(?:crash|freeze|broken|bug|error)/iu.test(text)) {
      return 'Learning Platform Reliability';
    }

    if (
      /(?:paywall|have to pay|gotta pay|limited).{0,40}(?:task|feature|access)?/iu.test(
        text,
      )
    ) {
      return 'Fair Access to Core Learning Features';
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

  /** Detects cross-device access complaints regardless of word order. */
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

    const direct = candidate.evidenceSamples.filter((sample) =>
      this.hasDirectComplaintSignal(sample),
    ).length;

    return direct / candidate.evidenceSamples.length;
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

    if (ranked[0].localRelevanceScore < 1) {
      warnings.push(
        'The selected location is a deployment target, not a location proven directly by the collected evidence.',
      );
    }

    return warnings;
  }

  private hasDirectComplaintSignal(value: string): boolean {
    return DIRECT_COMPLAINT_PATTERNS.some((pattern) => pattern.test(value));
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