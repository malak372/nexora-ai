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
import {
  classifyDirectCommunityEvidence,
  isNonActionableCommunityBanter,
  segmentCommunityEvidenceIssues,
} from '../../../nlp/common/utils/community-evidence.util';
import {
  clusterEvidenceByProblemFamily,
  matchEvidenceToAtomicProblem,
  matchEvidenceToProblemFamily,
} from '../../../nlp/common/utils/problem-family-matching.util';

const MAX_EVIDENCE_SAMPLES = 5;
const MAX_EVIDENCE_SAMPLE_LENGTH = 700;
const MAX_RANKED_OPPORTUNITIES = 8;
const LOW_NLP_CONFIDENCE_THRESHOLD = 0.5;
const MIN_SELECTION_RELIABILITY = 0.42;
const MIN_LOW_CONFIDENCE_RELIABILITY = 0.52;
const MIN_EVIDENCE_RELEVANCE_SCORE = 0.34;
const MIN_GENERIC_RELIABILITY_RELEVANCE_SCORE = 0.46;
const INELIGIBLE_SELECTION_PENALTY = 0.12;
const MIN_STRICT_OPPORTUNITY_SCORE = 0.4;
const MIN_STRICT_EVIDENCE_QUALITY = 0.4;
const MIN_STRICT_INDEPENDENT_EVIDENCE_COUNT = 1;
const MIN_SELECTED_DOMAIN_RELEVANCE = 0.3;
const OFF_DOMAIN_SELECTION_PENALTY = 0.28;

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

type SelectedDomainRankingInput = {
  readonly name: string;
  readonly keywords: readonly string[];
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
    selectedDomains: readonly SelectedDomainRankingInput[] = [],
  ): IdeaOpportunityRanking {
    const selectedDomainTerms = selectedDomains.flatMap((domain) => [
      domain.name,
      ...domain.keywords,
    ]);
    const extractedCandidates = [
      ...this.extractEvidenceFirstCandidates(nlp),
      ...this.extractCommunityAiCandidates(communityAiAnalysis),
      ...this.extractCommunityAiHypothesisCandidates(communityAiAnalysis),
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
        selectedDomainTerms,
        selectedDomains,
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
        if (first.selectionEligible !== second.selectionEligible) {
          return first.selectionEligible ? -1 : 1;
        }

        return (
          second.finalScore - first.finalScore ||
          second.supportScore - first.supportScore ||
          second.evidenceReliabilityScore - first.evidenceReliabilityScore ||
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

  reconcileVerifiedDomainAttribution(
    ranking: IdeaOpportunityRanking,
    selectedDomains: readonly SelectedDomainRankingInput[],
  ): IdeaOpportunityRanking {
    if (selectedDomains.length === 0) {
      return ranking;
    }

    const previousSelectedTitle = ranking.selected.title;
    const reconciled = [ranking.selected, ...ranking.alternatives].map(
      (candidate) =>
        this.reconcileVerifiedCandidateDomainAttribution(
          candidate,
          selectedDomains,
        ),
    );

    const ordered = reconciled
      .sort((first, second) => {
        if (first.selectionEligible !== second.selectionEligible) {
          return first.selectionEligible ? -1 : 1;
        }

        return (
          second.finalScore - first.finalScore ||
          (second.verifiedProblemMatchedDirectUserEvidenceCount ??
            second.verifiedIndependentEvidenceCount ??
            0) -
            (first.verifiedProblemMatchedDirectUserEvidenceCount ??
              first.verifiedIndependentEvidenceCount ??
              0) ||
          second.evidenceReliabilityScore - first.evidenceReliabilityScore ||
          second.supportScore - first.supportScore ||
          first.title.localeCompare(second.title)
        );
      })
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const [selected, ...alternatives] = ordered;
    if (!selected) {
      return ranking;
    }

    const relatedOpportunityBundle = this.buildRelatedOpportunityBundle(
      selected,
      alternatives,
      selectedDomains,
    );
    const selectedWithBundle =
      relatedOpportunityBundle.length > 0
        ? {
            ...selected,
            relatedOpportunityBundle,
            matchedDomainNames: [
              ...new Set([
                ...(selected.matchedDomainNames ?? []),
                ...relatedOpportunityBundle.flatMap(
                  (item) => item.matchedDomainNames,
                ),
              ]),
            ],
          }
        : selected;

    return {
      ...ranking,
      selected: selectedWithBundle,
      alternatives,
      selectionReason:
        selected.title === previousSelectedTitle
          ? ranking.selectionReason
          : `Selected the strongest verified evidence-backed opportunity after reconciling domain attribution with retained independent evidence: ${selected.title}.`,
    };
  }

  private buildRelatedOpportunityBundle(
    selected: RankedIdeaOpportunity,
    alternatives: readonly RankedIdeaOpportunity[],
    selectedDomains: readonly SelectedDomainRankingInput[],
  ): NonNullable<RankedIdeaOpportunity['relatedOpportunityBundle']> {
    const selectedFamily = this.readRankedFamilyKey(selected);
    const complementaryFamilies: Readonly<Record<string, readonly string[]>> = {
      'hr-candidate-pooling': ['hr-client-outreach'],
      'hr-client-outreach': ['hr-candidate-pooling'],
    };
    const allowed = complementaryFamilies[selectedFamily ?? ''] ?? [];
    const selectedMatchedDomains = new Set(
      (selected.matchedDomainNames ?? []).map((name) => name.toLocaleLowerCase()),
    );
    const allowedSelectedDomains = new Set(
      selectedDomains.map((domain) => domain.name.toLocaleLowerCase()),
    );

    const sameDomainComplements = alternatives.filter((candidate) => {
      if (candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN')) {
        return false;
      }
      const family = this.readRankedFamilyKey(candidate);
      if (!family || !allowed.includes(family)) return false;
      if ((candidate.verifiedProblemMatchedEvidenceCount ?? 0) < 1) return false;
      if (
        candidate.evidenceReliabilityScore < 0.45 ||
        candidate.supportScore < 0.3
      ) {
        return false;
      }
      return (candidate.matchedDomainNames ?? []).some((name) =>
        selectedMatchedDomains.has(name.toLocaleLowerCase()),
      );
    });

    const crossDomainComplements = alternatives.filter((candidate) => {
      if (candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN')) {
        return false;
      }
      if ((candidate.verifiedProblemMatchedEvidenceCount ?? 0) < 1) {
        return false;
      }
      if (
        candidate.evidenceReliabilityScore < 0.45 ||
        candidate.supportScore < 0.3
      ) {
        return false;
      }

      const candidateDomains = (candidate.matchedDomainNames ?? []).map((name) =>
        name.toLocaleLowerCase(),
      );
      if (
        candidateDomains.length === 0 ||
        !candidateDomains.some((name) => allowedSelectedDomains.has(name)) ||
        candidateDomains.some((name) => selectedMatchedDomains.has(name))
      ) {
        return false;
      }

      return this.calculateOpportunityCoherence(selected, candidate) >= 0.18;
    });

    const combined = [...sameDomainComplements, ...crossDomainComplements]
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex((item) => item.title === candidate.title) ===
          index,
      )
      .sort(
        (first, second) =>
          this.calculateOpportunityCoherence(selected, second) -
            this.calculateOpportunityCoherence(selected, first) ||
          (second.verifiedProblemMatchedEvidenceCount ?? 0) -
            (first.verifiedProblemMatchedEvidenceCount ?? 0) ||
          second.finalScore - first.finalScore,
      )
      .slice(0, 2);

    return combined.map((candidate) => ({
      rank: candidate.rank,
      title: candidate.title,
      problem: candidate.problem,
      need: candidate.need,
      solutionArea: candidate.solutionArea,
      evidenceType: candidate.evidenceType,
      evidenceSamples: candidate.evidenceSamples.slice(0, 2),
      matchedDomainNames: candidate.matchedDomainNames ?? [],
      verifiedProblemMatchedEvidenceCount:
        candidate.verifiedProblemMatchedEvidenceCount ?? 0,
      verifiedProblemMatchedDirectUserEvidenceCount:
        candidate.verifiedProblemMatchedDirectUserEvidenceCount ?? 0,
      verifiedProblemMatchedComplaintEvidenceCount:
        candidate.verifiedProblemMatchedComplaintEvidenceCount ?? 0,
      verifiedProblemMatchedFeatureRequestEvidenceCount:
        candidate.verifiedProblemMatchedFeatureRequestEvidenceCount ?? 0,
    }));
  }

  private calculateOpportunityCoherence(
    first: RankedIdeaOpportunity,
    second: RankedIdeaOpportunity,
  ): number {
    const normalize = (value: string): Set<string> => {
      const stopWords = new Set([
        'about',
        'application',
        'business',
        'company',
        'domain',
        'help',
        'issue',
        'management',
        'need',
        'needs',
        'operation',
        'operations',
        'platform',
        'problem',
        'software',
        'system',
        'user',
        'users',
        'workflow',
      ]);

      return new Set(
        value
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .split(/\s+/u)
          .filter((token) => token.length >= 4 && !stopWords.has(token)),
      );
    };

    const firstTokens = normalize(
      [
        first.title,
        first.problem ?? '',
        first.need ?? '',
        first.solutionArea ?? '',
      ].join(' '),
    );
    const secondTokens = normalize(
      [
        second.title,
        second.problem ?? '',
        second.need ?? '',
        second.solutionArea ?? '',
      ].join(' '),
    );

    if (firstTokens.size === 0 || secondTokens.size === 0) {
      return 0;
    }

    const intersection = [...firstTokens].filter((token) =>
      secondTokens.has(token),
    ).length;
    const smaller = Math.min(firstTokens.size, secondTokens.size);

    return intersection / Math.max(1, smaller);
  }

  private readRankedFamilyKey(candidate: RankedIdeaOpportunity): string | null {
    if (!this.isJsonObject(candidate.raw)) return null;
    return this.readString(candidate.raw.familyKey);
  }

  private reconcileVerifiedCandidateDomainAttribution(
    candidate: RankedIdeaOpportunity,
    selectedDomains: readonly SelectedDomainRankingInput[],
  ): RankedIdeaOpportunity {
    const verifiedEvidenceTexts = (candidate.independentEvidence ?? [])
      .map((evidence) => evidence.text.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);

    if (verifiedEvidenceTexts.length === 0) {
      return candidate;
    }

    const familyReconciledCandidate = this.reconcileVerifiedProblemFamily(
      candidate,
      verifiedEvidenceTexts,
    );
    const evidenceOnlyCandidate: NormalizedCandidate = {
      title: '',
      problem: null,
      need: null,
      solutionArea: null,
      evidenceType: familyReconciledCandidate.evidenceType,
      sourceIndex: familyReconciledCandidate.sourceIndex,
      frequency: familyReconciledCandidate.frequency,
      severity: familyReconciledCandidate.severity,
      evidenceSamples: verifiedEvidenceTexts,
      raw: familyReconciledCandidate.raw,
    };
    const verifiedDomainAttribution = this.calculateVerifiedDomainAttribution(
      evidenceOnlyCandidate,
      selectedDomains,
    );
    const {
      matchedDomainNames,
      problemDomainNames,
      workflowDomainNames,
      primaryMatchedDomainName,
      domainRelevanceScores,
      problemDomainRelevanceScores,
      workflowDomainRelevanceScores,
    } = verifiedDomainAttribution;
    const disqualificationReasons = new Set(
      familyReconciledCandidate.disqualificationReasons,
    );
    disqualificationReasons.delete('OFF_SELECTED_DOMAIN');

    if (matchedDomainNames.length === 0) {
      disqualificationReasons.add('OFF_SELECTED_DOMAIN');
    }

    return {
      ...familyReconciledCandidate,
      evidenceSamples: verifiedEvidenceTexts.slice(0, MAX_EVIDENCE_SAMPLES),
      frequency: Math.min(
        Math.max(familyReconciledCandidate.frequency, 1),
        verifiedEvidenceTexts.length,
      ),
      matchedDomainNames,
      problemDomainNames,
      workflowDomainNames,
      primaryMatchedDomainName,
      domainRelevanceScores,
      problemDomainRelevanceScores,
      workflowDomainRelevanceScores,
      selectionEligible:
        familyReconciledCandidate.selectionEligible &&
        matchedDomainNames.length > 0,
      disqualificationReasons: [...disqualificationReasons],
    };
  }

  private reconcileVerifiedProblemFamily(
    candidate: RankedIdeaOpportunity,
    verifiedEvidenceTexts: readonly string[],
  ): RankedIdeaOpportunity {
    const [verifiedCluster] = clusterEvidenceByProblemFamily(
      verifiedEvidenceTexts,
    );

    if (!verifiedCluster) {
      return candidate;
    }

    const rawObject = this.isJsonObject(candidate.raw) ? candidate.raw : null;
    const rawSource = rawObject ? this.readString(rawObject.source) : null;
    const currentDescriptor = [candidate.title, candidate.problem ?? '']
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const currentDescriptorMatches = verifiedEvidenceTexts.some((sample) =>
      matchEvidenceToProblemFamily(currentDescriptor, sample).matched,
    );
    const hasConcreteVerifiedFamily =
      verifiedCluster.key !== 'generic-friction' &&
      !verifiedCluster.key.startsWith('lexical:');
    const shouldRepair =
      rawSource === 'EVIDENCE_CLUSTER' ||
      (hasConcreteVerifiedFamily && !currentDescriptorMatches);

    if (!shouldRepair) {
      return candidate;
    }

    const repairedTitle = this.deriveVerifiedTitle(
      verifiedCluster.key,
      verifiedEvidenceTexts,
      verifiedCluster.label,
    );
    const repairedRaw: Prisma.JsonValue = rawObject
      ? ({
          ...rawObject,
          familyKey: verifiedCluster.key,
          title: repairedTitle,
          problem: repairedTitle,
          evidenceSamples: verifiedEvidenceTexts.slice(0, MAX_EVIDENCE_SAMPLES),
        } as Prisma.JsonObject)
      : candidate.raw;

    const repairedSolutionArea = this.deriveVerifiedSolutionArea(
      verifiedCluster.key,
      verifiedEvidenceTexts,
      candidate.solutionArea,
    );

    return {
      ...candidate,
      title: repairedTitle,
      problem: repairedTitle,
      need: this.deriveVerifiedNeed(verifiedCluster.key, repairedTitle),
      solutionArea: repairedSolutionArea,
      raw: repairedRaw,
    };
  }

  private calculateVerifiedDomainAttribution(
    candidate: NormalizedCandidate,
    selectedDomains: readonly SelectedDomainRankingInput[],
  ): {
    readonly matchedDomainNames: readonly string[];
    readonly problemDomainNames: readonly string[];
    readonly workflowDomainNames: readonly string[];
    readonly primaryMatchedDomainName: string | null;
    readonly domainRelevanceScores: Readonly<Record<string, number>>;
    readonly problemDomainRelevanceScores: Readonly<Record<string, number>>;
    readonly workflowDomainRelevanceScores: Readonly<Record<string, number>>;
  } {
    const problemCandidate = this.buildDomainSemanticCandidate(candidate, false);
    const workflowCandidate = this.buildDomainSemanticCandidate(candidate, true);
    const problemScores: Record<string, number> = {};
    const workflowScores: Record<string, number> = {};
    const combinedScores: Record<string, number> = {};

    for (const domain of selectedDomains) {
      const terms = this.expandDomainSemanticTerms(domain);
      const problemScore = this.passesSelectedDomainContextGuard(
        domain.name,
        problemCandidate,
      )
        ? this.calculateSelectedDomainRelevance(problemCandidate, terms)
        : 0;
      const workflowScore = this.passesSelectedDomainContextGuard(
        domain.name,
        workflowCandidate,
      )
        ? this.calculateSelectedDomainRelevance(workflowCandidate, terms)
        : 0;

      problemScores[domain.name] = this.round(problemScore);
      workflowScores[domain.name] = this.round(workflowScore);
      combinedScores[domain.name] = this.round(
        Math.max(problemScore, workflowScore * 0.55),
      );
    }

    const problemDomainNames = Object.entries(problemScores)
      .filter(([, score]) => score >= MIN_SELECTED_DOMAIN_RELEVANCE)
      .sort((left, right) => right[1] - left[1])
      .map(([name]) => name);

    const workflowDomainNames = Object.entries(workflowScores)
      .filter(
        ([name, score]) =>
          score >= 0.6 && !problemDomainNames.includes(name),
      )
      .sort((left, right) => right[1] - left[1])
      .map(([name]) => name);

    const matchedDomainNames = [
      ...problemDomainNames,
      ...workflowDomainNames,
    ];

    const primaryMatchedDomainName =
      problemDomainNames[0] ??
      Object.entries(combinedScores)
        .filter(([, score]) => score >= MIN_SELECTED_DOMAIN_RELEVANCE)
        .sort((left, right) => right[1] - left[1])[0]?.[0] ??
      null;

    return {
      matchedDomainNames,
      problemDomainNames,
      workflowDomainNames,
      primaryMatchedDomainName,
      domainRelevanceScores: combinedScores,
      problemDomainRelevanceScores: problemScores,
      workflowDomainRelevanceScores: workflowScores,
    };
  }

  private deriveVerifiedTitle(
    familyKey: string,
    verifiedEvidenceTexts: readonly string[],
    fallbackLabel: string,
  ): string {
    const evidenceText = verifiedEvidenceTexts.join(' ').toLocaleLowerCase();

    if (familyKey === 'ai-model-containment') {
      return 'AI Model Containment and Sandbox Escape Failures';
    }

    if (familyKey === 'energy-monitor-installation') {
      return 'Energy Monitor Sensor Installation and Setup Friction';
    }

    if (familyKey === 'streaming-data-integrity') {
      return 'Streaming Data Integrity and Staleness Failures';
    }

    if (familyKey === 'accessibility-focus-navigation') {
      return 'Accessibility Focus and Keyboard Navigation Failures';
    }

    if (familyKey === 'authentication') {
      return 'Login and Account Access Failures';
    }

    if (familyKey === 'hr-candidate-pooling') {
      return 'Candidate Profile Pooling and Reuse for Recurring Hiring';
    }

    if (familyKey === 'hr-client-outreach') {
      return 'Client Contact Mass Outreach Gaps in Applicant Tracking Systems';
    }

    if (familyKey === 'mental-health-time-access') {
      return 'Workday Mental Health Time-Access Constraints';
    }

    if (familyKey === 'healthcare-treatment-access') {
      return 'Cross-Border Treatment Availability and Access Gaps';
    }

    if (familyKey === 'clinical-sparse-measurements') {
      return 'Sparse Clinical Measurement and Missing-by-Design Data Gaps';
    }

    if (
      familyKey === 'blockchain-wallet-state-sync' ||
      (/\b(?:wallet|account balance|wallet balance|transactions?|confirmations?)\b/iu.test(
        evidenceText,
      ) &&
        /\b(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|synchroni[sz])\b/iu.test(
          evidenceText,
        ) &&
        /\b(?:blockchain|wallet|confirmed|confirmation)\b/iu.test(evidenceText))
    ) {
      return 'Wallet Transaction Visibility and State Synchronization Failures';
    }

    if (
      familyKey === 'billing-payment' &&
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation|refund)/iu.test(
        evidenceText,
      )
    ) {
      return 'Cash Payment Reconciliation and Duplicate Charge Failures';
    }

    if (
      familyKey === 'billing-payment' &&
      /(?:international card|foreign card|international number|foreign number|traveling from abroad|travelling from abroad)/iu.test(
        evidenceText,
      ) &&
      /(?:otp|verification|cannot use|can['’]?t use|could not use|not accept)/iu.test(
        evidenceText,
      )
    ) {
      return 'International Card and OTP Access Barriers for Travelers';
    }

    if (familyKey.startsWith('lexical:')) {
      return 'Specific User Workflow Friction';
    }

    return fallbackLabel;
  }

  private deriveVerifiedNeed(familyKey: string, familyLabel: string): string {
    if (familyKey === 'ai-model-containment') {
      return 'AI evaluation teams need a controlled way to detect, triage, and review model containment or sandbox-boundary violations during security testing';
    }
    if (familyKey === 'energy-monitor-installation') {
      return 'Energy-monitoring users need a simpler guided setup for installing, mapping, and validating multiple sensors or current transformers without excessive manual configuration';
    }
    if (familyKey === 'streaming-data-integrity') {
      return 'Streaming teams need integrity monitoring that detects stale, skewed, or incorrect payloads even when the pipeline does not crash or emit an error';
    }
    if (familyKey === 'accessibility-focus-navigation') {
      return 'Users need accessible focus recovery and keyboard navigation that cannot be trapped by stale or hidden interface controls';
    }
    if (familyKey === 'hr-candidate-pooling') {
      return 'Recruiters need structured candidate-profile pooling, sorting, and reuse for recurring hiring workflows';
    }
    if (familyKey === 'hr-client-outreach') {
      return 'Recruiters and staffing teams need controlled mass outreach to saved client contacts inside applicant-tracking workflows';
    }
    if (familyKey === 'real-estate-session-persistence') {
      return 'Real-estate search users need stable signed-in sessions that preserve active search and saved-property workflows';
    }
    if (familyKey === 'real-estate-favorites-filtering') {
      return 'Housing seekers need location-aware filtering over saved homes and favorite listings';
    }
    if (familyKey === 'real-estate-multi-criteria-filtering') {
      return 'Housing seekers need to combine multiple property criteria in the same search or saved-list filtering workflow';
    }
    if (familyKey === 'real-estate-tag-persistence') {
      return 'Real-estate users need custom property tags and notes to persist reliably across sessions';
    }
    if (familyKey === 'feature-change-notification') {
      return 'Users need clear notice and migration guidance when important product functionality changes or is removed';
    }
    if (familyKey === 'mental-health-time-access') {
      return 'People need lower-friction ways to protect small periods of mental-health recovery within constrained daily schedules';
    }
    if (familyKey === 'healthcare-treatment-access') {
      return 'Patients and clinicians need clearer ways to identify treatment availability constraints and feasible access pathways across health systems';
    }
    if (familyKey === 'clinical-sparse-measurements') {
      return 'Clinical analytics workflows need explicit handling of sparse and missing-by-design measurements without treating absent observations as persisted-record loss';
    }
    if (familyKey === 'blockchain-wallet-state-sync') {
      return 'Reliable reconciliation between confirmed blockchain transactions and wallet-visible balances, confirmation counts, and transaction history';
    }
    if (familyKey === 'billing-payment') {
      return 'Reliable Payment Reconciliation and Duplicate Charge Recovery';
    }
    if (familyKey === 'authentication') {
      return 'Reliable Login, Authentication, and Account Access Recovery';
    }
    if (familyKey === 'navigation-routing') {
      return 'Reliable Navigation, Redirect, and Endpoint Recovery';
    }
    if (familyKey === 'legal-research-access') {
      return 'Affordable Legal Evidence Documentation with Factuality Review';
    }
    if (familyKey === 'therapeutic-continuity') {
      return 'Stable Therapeutic Persona, Voice, and Interaction Continuity Across Updates';
    }
    if (familyKey === 'regional-crypto-access') {
      return 'Region-Compatible Crypto Access and Clearly Supported Alternative Wallet or Exchange Paths';
    }

    if (familyKey.startsWith('lexical:')) {
      return 'Users need a more reliable way to complete the specific workflow described by the retained evidence without the observed friction.';
    }

    return `Users need a more reliable way to avoid or recover from ${familyLabel.toLowerCase()}.`;
  }

  private deriveVerifiedSolutionArea(
    familyKey: string,
    verifiedEvidenceTexts: readonly string[],
    fallback: string | null,
  ): string | null {
    const evidenceText = verifiedEvidenceTexts.join(' ').toLowerCase();

    if (familyKey === 'ai-model-containment') {
      return 'AI Model Security, Sandbox Boundary Monitoring, and Human-Reviewed Triage';
    }

    if (familyKey === 'energy-monitor-installation') {
      return 'Guided Energy Monitor Sensor Setup, Mapping, and Configuration Diagnostics';
    }

    if (familyKey === 'streaming-data-integrity') {
      return 'Streaming Data Integrity, Validation, and Observability';
    }

    if (familyKey === 'accessibility-focus-navigation') {
      return 'Accessible Focus Management and Keyboard Navigation Recovery';
    }

    if (familyKey === 'hr-candidate-pooling') {
      return 'Candidate Profile Pooling and Recurring Hiring Management';
    }

    if (familyKey === 'hr-client-outreach') {
      return 'ATS Client Contact Outreach and Campaign Management';
    }

    if (familyKey === 'real-estate-session-persistence') {
      return 'Real Estate Session Reliability and State Preservation';
    }

    if (familyKey === 'real-estate-favorites-filtering') {
      return 'Saved Property Search and Location Filtering';
    }

    if (familyKey === 'real-estate-multi-criteria-filtering') {
      return 'Composable Property Search and Multi-Criteria Filtering';
    }

    if (familyKey === 'real-estate-tag-persistence') {
      return 'Property Tagging, Notes, and Saved-State Persistence';
    }

    if (familyKey === 'feature-change-notification') {
      return 'Feature Change Communication and Migration Guidance';
    }

    if (familyKey === 'mental-health-time-access') {
      return 'Workday Mental Health Time Access and Recovery Planning';
    }

    if (familyKey === 'healthcare-treatment-access') {
      return 'Treatment Availability Navigation and Access Validation';
    }

    if (familyKey === 'clinical-sparse-measurements') {
      return 'Sparse Clinical Data Quality and Missingness Diagnostics';
    }

    if (familyKey === 'blockchain-wallet-state-sync') {
      return 'Wallet State Reconciliation and Transaction Visibility Diagnostics';
    }

    if (familyKey === 'billing-payment') {
      if (
        /(?:paid .*cash|cash .*paid|charged .*again|double charg|duplicate charg|already paid|payment reconciliation|refund)/iu.test(
          evidenceText,
        )
      ) {
        return 'Payment Reconciliation and Duplicate Charge Recovery';
      }
      if (
        /(?:connect .*bank|bank .*connect|venmo|payment method|card connected|link(?:ing)? .*card)/iu.test(
          evidenceText,
        )
      ) {
        return 'Payment Method Linking and Charge Consistency';
      }
      return 'Billing and Payment Recovery';
    }

    if (familyKey === 'authentication') {
      return 'Authentication Session and Identity Provider Recovery';
    }

    if (familyKey === 'navigation-routing') {
      return 'Navigation and Routing Endpoint Recovery';
    }

    if (familyKey === 'legal-research-access') {
      return 'Affordable Legal Evidence Documentation and Factuality Review';
    }

    if (familyKey === 'therapeutic-continuity') {
      return 'Therapeutic Persona Continuity and Asset Regression Monitoring';
    }

    if (familyKey === 'regional-crypto-access') {
      return 'Regional Crypto Access Compatibility and Alternative Platform Guidance';
    }

    return fallback;
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

    const selectionMode = selected.selectionEligible
      ? 'STRICT_EVIDENCE_SELECTION'
      : 'LOW_EVIDENCE_FALLBACK';

    return [
      `Selection mode: ${selectionMode}.`,
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

  private extractCommunityAiHypothesisCandidates(
    analysis: CommunityAiAnalysis | null,
  ): NormalizedCandidate[] {
    if (!analysis || analysis.unvalidatedDomainHypotheses.length === 0) {
      return [];
    }

    return analysis.unvalidatedDomainHypotheses.map((hypothesis, sourceIndex) => ({
      title: hypothesis.title,
      problem: hypothesis.problem,
      need: hypothesis.unmetNeed,
      solutionArea: hypothesis.solutionArea,
      evidenceType: IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY,
      sourceIndex: sourceIndex + 10_000,
      frequency: 0,
      severity: 'MEDIUM',
      evidenceSamples: [],
      raw: {
        ...hypothesis,
        source: 'COMMUNITY_AI_HYPOTHESIS',
        groundingScore: 0,
        unvalidatedHypothesis: true,
      } as unknown as Prisma.JsonValue,
    }));
  }

  /**
   * Builds opportunity candidates from the retained evidence itself before any
   * Community-AI wording is considered. This makes the evidence cluster the
   * source of truth and prevents a valid complaint corpus from being discarded
   * merely because the AI described the same problem with different words.
   */
  private extractEvidenceFirstCandidates(
    nlp: IdeaGenerationNlpContext,
  ): NormalizedCandidate[] {
    const directEvidence = this.deduplicateEvidenceSamples([
      ...this.readEvidenceTextsFromJson(nlp.sampleComments),
      ...this.readEvidenceTextsFromJson(nlp.samplePosts),
    ])
      .filter((sample) => {
        const commentBody =
          sample.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim() ?? sample;
        const commentKind = classifyDirectCommunityEvidence(
          commentBody,
          'COMMENT',
        );
        const postKind = classifyDirectCommunityEvidence(sample, 'POST');
        return (
          commentKind === 'USER_COMPLAINT' ||
          commentKind === 'FEATURE_REQUEST' ||
          postKind === 'USER_COMPLAINT' ||
          postKind === 'FEATURE_REQUEST' ||
          this.hasDirectComplaintSignal(sample)
        );
      })
      .flatMap((sample) => segmentCommunityEvidenceIssues(sample))
      .filter((sample) => this.hasDirectComplaintSignal(sample));

    return clusterEvidenceByProblemFamily(this.deduplicateEvidenceSamples(directEvidence))
      .slice(0, MAX_RANKED_OPPORTUNITIES)
      .map((cluster, sourceIndex) => ({
        title: cluster.label,
        problem: cluster.label,
        need: `Users need a more reliable way to avoid or recover from ${cluster.label.toLowerCase()}.`,
        solutionArea: null,
        evidenceType: IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM,
        sourceIndex,
        frequency: cluster.evidenceSamples.length,
        severity: null,
        evidenceSamples: [...cluster.evidenceSamples].slice(0, MAX_EVIDENCE_SAMPLES),
        raw: {
          source: 'EVIDENCE_CLUSTER',
          familyKey: cluster.key,
          title: cluster.label,
          problem: cluster.label,
          frequency: cluster.evidenceSamples.length,
          evidenceSamples: [...cluster.evidenceSamples].slice(0, MAX_EVIDENCE_SAMPLES),
        } as unknown as Prisma.JsonValue,
      }));
  }

  /** Reads representative NLP evidence from either string arrays or {text} objects. */
  private readEvidenceTextsFromJson(value: Prisma.JsonValue | null): string[] {
    if (!value) return [];

    if (typeof value === 'string') {
      const normalized = value.replace(/\s+/gu, ' ').trim();
      return normalized ? [normalized] : [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.readEvidenceTextsFromJson(entry));
    }

    if (typeof value === 'object') {
      const object = value as Prisma.JsonObject;
      const directText =
        typeof object.text === 'string'
          ? object.text.replace(/\s+/gu, ' ').trim()
          : '';

      if (directText) return [directText];

      return Object.values(object).flatMap((entry) =>
        this.readEvidenceTextsFromJson(entry as Prisma.JsonValue),
      );
    }

    return [];
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
      groundingScore >= 50 ||
      (source === 'COMMUNITY_LLM_ANALYSIS' && confidence >= 70);

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

  /**
   * Rejects article/video/review headlines as internal problem-family titles.
   * Ranked titles should be short reusable labels, not copied source content.
   */
  private isProfessionalOpportunityTitle(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const wordCount = normalized.split(/\s+/u).length;

    if (normalized.length > 96 || wordCount > 12) return false;

    const narrativeFragment =
      /^(?:\d+|one|two|three|four|five)\s+(?:days?|weeks?|months?|years?)\s+ago\b/iu.test(
        normalized,
      ) ||
      /^(?:i|we)\s+(?:am|are|was|were|made|paid|tried|used|have|had|cannot|can['’]?t|could not|couldn['’]?t)\b/iu.test(
        normalized,
      );

    if (narrativeFragment) return false;

    if (
      /^(?:bounded|evidence[- ]grounded) validation workflow\b|^a bounded validation workflow\b/iu.test(
        normalized,
      )
    ) {
      return false;
    }

    return !/(?:\b20\d{2}\b|\bupdate\b|\bguide\b|\bhere'?s\b|\bfirst time visiting\b|\bhow to\b|[!?]{1,})/iu.test(
      normalized,
    );
  }

  /**
   * Produces a concise, auditable problem-family title from retained evidence.
   * It uses deterministic domain patterns first and a bounded semantic phrase
   * fallback second, so no extra AI call or latency is introduced.
   */
  private deriveProfessionalCommunityTitle(
    candidate: NormalizedCandidate,
    evidenceSamples: readonly string[],
  ): string {
    const context = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
      ...evidenceSamples,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .replace(/\s+/gu, ' ')
      .toLowerCase();

    if (
      /(?:got married|married|name change|changed my (?:sur)?name|changed (?:my )?(?:sur)?name)/iu.test(
        context,
      ) &&
      /(?:government department|government departments|agencies|hmrc|dvla|passport office|dwp|student loans|land registry|record updated)/iu.test(
        context,
      )
    ) {
      return 'Cross-Agency Life-Event Record Update Coordination';
    }

    if (
      /(?:streaming pipeline|streaming data|data pipeline)/iu.test(context) &&
      /(?:stale|skewed|incorrect|wrong|corrupt|quietly serving|silently serving)/iu.test(
        context,
      )
    ) {
      return 'Streaming Data Integrity and Staleness Failures';
    }

    if (
      /(?:can(?:not|['’]?t)|unable to)\s+(?:access|login|log in|sign in|log into|sign into)\s+(?:my|the|this)?\s*account|locked out(?: of)?\s+(?:my|the|this)?\s*account/iu.test(
        context,
      )
    ) {
      return 'Login and Account Access Failures';
    }

    if (
      /\b(?:wallet|account balance|wallet balance|transaction history|transactions?|confirmations?)\b/iu.test(
        context,
      ) &&
      /\b(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|zero|0|visibility|synchroni[sz])\b/iu.test(
        context,
      ) &&
      /\b(?:blockchain|wallet|confirmed|confirmation)\b/iu.test(context)
    ) {
      return 'Wallet Transaction Visibility and State Synchronization Failures';
    }

    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|refund|payment reconciliation|driver|rider)/iu.test(
        context,
      )
    ) {
      return 'Cash Payment Reconciliation and Duplicate Charge Failures';
    }

    if (
      /(?:venmo|bank|payment method|card)/iu.test(context) &&
      /(?:connect|link|connected|charged|charge)/iu.test(context)
    ) {
      return 'Payment Method Linking and Charge Consistency Failures';
    }

    if (
      /(?:international card|foreign card|international number|foreign number|traveling from abroad|travelling from abroad|traveler|traveller)/iu.test(
        context,
      ) &&
      /(?:otp|verification|card|payment|cannot use|can['’]?t use|could not use|not accept)/iu.test(
        context,
      )
    ) {
      return 'International Card and OTP Access Barriers for Travelers';
    }

    if (
      /\b(?:fare|ticket|contactless|tube|bus|transit).{0,100}(?:confus|unclear|difficult|how to pay)|(?:confus|unclear|difficult).{0,100}\b(?:fare|ticket|contactless|transit|bus|tube)\b/iu.test(
        context,
      )
    ) {
      return 'First-Time Transit Fare Payment Confusion';
    }

    if (/\b(?:traffic|highway|bottleneck|congestion|delay)\b/iu.test(context)) {
      return 'Urban Traffic Bottleneck and Delay Reduction';
    }

    if (/\b(?:route|journey|navigation).{0,80}(?:confus|unclear|difficult|missing)\b/iu.test(context)) {
      return 'Public Transport Route Guidance Friction';
    }

    if (
      /\b(?:monoculture|agroforestry|biodynamic|crop diversification|smallholder|small-scale farm|land concentration)\b/iu.test(
        context,
      )
    ) {
      return 'Smallholder Crop Diversification Planning Barriers';
    }

    const derived = this.deriveConcreteTitle(evidenceSamples);
    if (derived && this.isProfessionalOpportunityTitle(derived)) {
      return this.canonicalizeOpportunityTitle(derived);
    }

    const source =
      candidate.problem ?? candidate.need ?? candidate.solutionArea ?? candidate.title;
    const cleaned = source
      .replace(/\([^)]*\)/gu, ' ')
      .replace(/\b(?:20\d{2}|update|guide|video|review)\b/giu, ' ')
      .replace(/[^\p{L}\p{N} -]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const words = cleaned.split(/\s+/u).filter(Boolean).slice(0, 9);

    return this.canonicalizeOpportunityTitle(
      words.length >= 3 ? words.join(' ') : `${candidate.title} Workflow Friction`,
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

    if (
      isCommunityAiCandidate &&
      !this.isSemanticallyAlignedWithDeclaredDomain(workingCandidate)
    ) {
      return null;
    }

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

    /*
     * Normalize the corpus once, but do not apply the generic diagnostic-text
     * filter before validating Community-AI grounding. A grounded workflow
     * report can describe confusion, friction, or a missing capability without
     * containing classic bug words such as "error" or "crash". Applying
     * isNonDiagnosticEvidence first previously erased those exact samples and
     * produced the contradictory state groundingScore=100 with
     * evidenceSamples=[] in the ranked opportunity.
     */
    const corpusEvidence = workingCandidate.evidenceSamples
      .map((sample) => this.normalizeEvidenceSample(sample))
      .filter(Boolean)
      .filter((sample) => !this.isPromotionalOnlyEvidence(sample))
      .filter((sample) => {
        const body = sample.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim();
        return !body || !isNonActionableCommunityBanter(body, 'COMMENT');
      });

    const normalizedEvidence = corpusEvidence.filter(
      (sample) => !this.isNonDiagnosticEvidence(sample),
    );

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
      ? corpusEvidence.filter((sample) =>
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

    /*
     * Community AI already returns a structured, corpus-grounded title.
     * Preserve that title when it is specific instead of remapping it through
     * a broad rule-based family label such as "Data Loss" or "Login Failure".
     */
    const preserveCommunityTitle =
      isCommunityAiCandidate &&
      !GENERIC_LABELS.has(normalizedTitle) &&
      originalTitle.split(/\s+/u).length >= 3 &&
      this.isProfessionalOpportunityTitle(originalTitle);
    const finalTitle = preserveCommunityTitle
      ? originalTitle
      : isCommunityAiCandidate
        ? this.deriveProfessionalCommunityTitle(
            workingCandidate,
            titleDerivationEvidence,
          )
        : tentativeTitle
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

    const repairedProblem = this.repairTruncatedDescriptorFromEvidence(
      workingCandidate.problem,
      evidenceSamples,
    );
    const alignedDescriptors = this.deriveAlignedDescriptors(
      finalTitle,
      repairedProblem,
      workingCandidate.need,
      workingCandidate.solutionArea,
      isCommunityAiCandidate,
    );

    const boundedEvidenceSamples = evidenceSamples.slice(
      0,
      MAX_EVIDENCE_SAMPLES,
    );

    return {
      ...workingCandidate,
      title: finalTitle,
      problem: alignedDescriptors.problem,
      need: alignedDescriptors.need,
      solutionArea: alignedDescriptors.solutionArea,
      /*
       * Frequency must remain auditable. Community AI can estimate a larger
       * count than the evidence excerpts actually retained, but downstream
       * scoring must never treat an unsupported estimate as repeated demand.
       */
      frequency: this.boundFrequencyToIndependentEvidence(
        workingCandidate.frequency,
        boundedEvidenceSamples,
      ),
      evidenceSamples: boundedEvidenceSamples,
    };
  }

  /**
   * Prevents a candidate from being assigned to a selected domain merely
   * because the evidence mentions that domain as a dataset label, search term,
   * quoted title, or incidental context. The actual operational problem must
   * contain domain-specific workflow language.
   */
  private isSemanticallyAlignedWithDeclaredDomain(
    candidate: NormalizedCandidate,
  ): boolean {
    if (!this.isJsonObject(candidate.raw)) return true;

    const domainName = (this.readString(candidate.raw.domainName) ?? '')
      .trim()
      .toLowerCase();
    if (!domainName) return true;

    const descriptor = [
      candidate.title,
      candidate.problem ?? '',
      candidate.need ?? '',
      candidate.solutionArea ?? '',
    ]
      .join(' ')
      .replace(/[“”"'][^“”"']{0,180}[“”"']/gu, ' ')
      .replace(/\b(?:dataset|data set|search term|keyword|topic|title|query)\s+(?:for|named|called|about)?\s*[^,.!?;:]{0,100}/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLowerCase();

    const domainSignals: Readonly<Record<string, readonly RegExp[]>> = {
      'artificial intelligence': [
        /\b(?:artificial intelligence|machine learning|deep learning|neural network|llm|large language model|prompt|inference|training model|ai model|chatbot|computer vision|natural language processing|recommendation model|predictive model)\b/iu,
      ],
      finance: [
        /\b(?:finance|financial|fintech|payment|invoice|billing|budget|expense|revenue|accounting|bookkeeping|banking|credit|loan|investment|cash flow|fraud|payroll|procurement|reconciliation|approval workflow|administrative workflow|administrative operations|back office|manual data entry)\b/iu,
      ],
      energy: [
        /\b(?:energy|electricity|power grid|solar|wind turbine|battery|consumption|kilowatt|renewable|utility|metering|load forecast)\b/iu,
      ],
    };

    const patterns = domainSignals[domainName];
    if (!patterns) return true;

    return patterns.some((pattern) => pattern.test(descriptor));
  }

  private repairTruncatedDescriptorFromEvidence(
    problem: string | null,
    evidenceSamples: readonly string[],
  ): string | null {
    const normalized = problem?.replace(/\s+/gu, ' ').trim() ?? '';
    const lastWord =
      normalized.split(/\s+/u).at(-1)?.replace(/[^\p{L}\p{N}-]+/gu, '') ?? '';
    const looksTruncated =
      normalized.length > 0 &&
      !/[.!?]["')\]]?$/u.test(normalized) &&
      normalized.length < 170 &&
      lastWord.length <= 4;

    if (!looksTruncated) {
      return problem;
    }

    for (const sample of evidenceSamples) {
      const match = sample
        .replace(/\s+/gu, ' ')
        .match(
          /(?:problem statement|problem|issue|pain point)\s*:?\s*(.+?)(?=\s+(?:proposed solution|solution|alternatives considered|feature summary|mockups|additional context)\b|$)/iu,
        );
      const extracted = match?.[1]?.replace(/\s+/gu, ' ').trim();
      if (extracted && extracted.length >= 35) {
        return extracted.length <= 260
          ? extracted
          : extracted.slice(0, extracted.lastIndexOf(' ', 260)).trim();
      }
    }

    return problem;
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
      const professional = this.buildProfessionalCommunityDescriptors(
        title,
        problem,
        need,
        solutionArea,
      );

      return professional;
    }

    const context = [title, problem].filter(Boolean).join(' ').toLowerCase();

    if (
      /\b(?:wallet|account balance|wallet balance|transaction history|transactions?|confirmations?)\b/iu.test(
        context,
      ) &&
      /\b(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|synchroni[sz])\b/iu.test(
        context,
      ) &&
      /\b(?:blockchain|wallet|confirmed|confirmation)\b/iu.test(context)
    ) {
      return {
        problem: 'Wallet Transaction Visibility and State Synchronization Failures',
        need: 'Reliable reconciliation between confirmed blockchain transactions and wallet-visible balances, confirmation counts, and transaction history',
        solutionArea: 'Wallet State Reconciliation and Transaction Visibility Diagnostics',
      };
    }

    if (
      /\b(?:taking time for mental health|time for mental health|mental health time|mental health break|recovery time|self-care time)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: 'Workday Mental Health Time-Access Constraints',
        need: 'People need lower-friction ways to protect small periods of mental-health recovery within constrained daily schedules.',
        solutionArea: 'Workday Mental Health Time Access and Recovery Planning',
      };
    }

    if (
      /\b(?:treatment|care|medicine|therapy)\b[^.!?]{0,160}\b(?:unavailable|not available|another country|one country|cannot access|can['’]?t access)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: 'Cross-Border Treatment Availability and Access Gaps',
        need: 'Patients and clinicians need clearer ways to identify treatment availability constraints and feasible access pathways across health systems.',
        solutionArea: 'Treatment Availability Navigation and Access Validation',
      };
    }

    if (
      /\b(?:missing|null) values?\b|\b(?:imput(?:e|ing|ation)|forward[- ]fill|sparse features?|test results?)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: 'Sparse Clinical Measurement and Missing-by-Design Data Gaps',
        need: 'Clinical analytics workflows need explicit handling of sparse and missing-by-design measurements without treating absent observations as persisted-record loss.',
        solutionArea: 'Sparse Clinical Data Quality and Missingness Diagnostics',
      };
    }

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
      /\b(?:payment|billing|charged|charge|refund|reconciliation|cash payment|double charge|duplicate charge)\b/iu.test(
        context,
      ) &&
      /\b(?:cash|already paid|charged again|double|duplicate|reconciliation|refund|driver|rider|payment method|bank|card|venmo)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: title,
        need: 'Reliable Payment Reconciliation and Duplicate Charge Recovery',
        solutionArea: 'Payment Reconciliation and Duplicate Charge Recovery',
      };
    }

    if (
      /\b(?:rental lease[- ]term|lease[- ]term|lease term|rental length|lease duration|short[- ]term rental|long[- ]term rental|vacation rental)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: title,
        need: 'A rental-search workflow that can include or exclude listings by lease duration and separate long-term housing from short-term rentals.',
        solutionArea: 'Lease-Term Search Filtering and Rental Relevance',
      };
    }

    if (
      /\b(?:subscription|purchase|payment|billing|renewal|receipt|restore purchase|purchase restoration|subscription restoration)\b/iu.test(
        context,
      )
    ) {
      return {
        problem: title,
        need: 'Reliable Billing, Purchase, and Subscription Recovery',
        solutionArea: 'Billing and Purchase Recovery',
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


  private buildProfessionalCommunityDescriptors(
    title: string,
    problem: string | null,
    need: string | null,
    solutionArea: string | null,
  ): { problem: string; need: string | null; solutionArea: string | null } {
    const context = [title, problem, need, solutionArea]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    if (
      /\b(?:monoculture|agroforestry|biodynamic|crop diversification|smallholder|land concentration)\b/iu.test(
        context,
      )
    ) {
      return {
        problem:
          'Smallholder farmers may lack a structured way to evaluate and plan transitions from monoculture production toward diversified agroforestry or biodynamic crop systems.',
        need:
          'A guided, evidence-qualified planning workflow for comparing crop-diversification options, resource requirements, and phased transition steps.',
        solutionArea:
          'Smallholder Crop Diversification and Transition Planning',
      };
    }

    return {
      problem:
        problem && !GENERIC_LABELS.has(problem.toLowerCase())
          ? this.rewriteQuotedCommunityProblem(problem)
          : title,
      need: need && !GENERIC_LABELS.has(need.toLowerCase())
        ? this.rewriteQuotedCommunityProblem(need)
        : null,
      solutionArea:
        solutionArea && !GENERIC_LABELS.has(solutionArea.toLowerCase())
          ? solutionArea
          : null,
    };
  }

  private rewriteQuotedCommunityProblem(value: string): string {
    return value
      .replace(/^A reliable workflow that resolves:\s*/iu, '')
      .replace(/^While we keep growing/iu, 'Continued reliance on')
      .replace(/, which are used more for feeding animals than to our consumption, we still going to need those substances\.?/iu,
        ' for animal feed may constrain adoption of diversified food-production practices.')
      .replace(/\s+/gu, ' ')
      .trim();
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
   * Resolves a concrete opportunity family used to prevent cross-candidate
   * descriptor fusion. Families are intentionally narrow: a cybersecurity
   * incident must never merge with ordinary synchronization failures, and a
   * mobile feature-parity complaint must never inherit a data-loss title.
   */
  private resolveOpportunityFamily(candidate: NormalizedCandidate): string {
    const context = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
      ...candidate.evidenceSamples,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    if (
      /\b(?:ransomware|data breach|cyberattack|malware|attacker deleted|compromised personal information)\b/iu.test(
        context,
      )
    ) {
      return 'CYBERSECURITY_INCIDENT';
    }

    if (
      /\b(?:feature parity|missing pages|not accessible through the app|forced to use the website|transcripts|student info)\b/iu.test(
        context,
      )
    ) {
      return 'MOBILE_FEATURE_PARITY';
    }

    if (
      /\b(?:cancelled|canceled)\s+applications?\b|\b(?:active|action)\s+queues?\b|\bqueue integrity\b|\bnon-actionable items?\b/iu.test(
        context,
      )
    ) {
      return 'ADMINISTRATIVE_QUEUE_INTEGRITY';
    }

    if (
      /\b(?:soroban|stellar wallet|on-chain|off-chain|smart contract|emit(?:s|ted)? an? event|ledger sequence)\b/iu.test(
        context,
      )
    ) {
      return 'BLOCKCHAIN_IMPLEMENTATION_TASK';
    }

    if (
      /\b(?:sync|synchronization|data transfer|storage destination|sd-card|phone storage|network timeout|file transfer)\b/iu.test(
        context,
      )
    ) {
      return 'DATA_SYNCHRONIZATION';
    }

    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation|refund)/iu.test(
        context,
      )
    ) {
      return 'CASH_PAYMENT_RECONCILIATION';
    }

    if (
      /(?:international card|foreign card|international number|foreign number|traveling from abroad|travelling from abroad)/iu.test(
        context,
      ) &&
      /(?:otp|verification|card|payment|cannot use|can['’]?t use|could not use|not accept)/iu.test(
        context,
      )
    ) {
      return 'CROSS_BORDER_PAYMENT_VERIFICATION';
    }

    if (
      /(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign).{0,120}(?:client contacts?|clients?)|(?:client contacts?|clients?).{0,120}(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign)/iu.test(
        context,
      )
    ) {
      return 'HR_CLIENT_CONTACT_OUTREACH';
    }

    if (
      /(?:(?:candidate|applicant) profiles?|\bprofiles?\b).{0,140}(?:sav(?:e|ing)?|sort|portal|pool|reuse|regular basis|recurring hiring|hire store workers)|(?:sav(?:e|ing)?|sort|portal|pool|reuse).{0,140}(?:(?:candidate|applicant) profiles?|\bprofiles?\b)/iu.test(
        context,
      )
    ) {
      return 'HR_CANDIDATE_PROFILE_POOLING';
    }

    if (
      /\b(?:login|authentication|activation|verification|session|token)\b/iu.test(
        context,
      )
    ) {
      return 'AUTHENTICATION';
    }

    if (
      /\b(?:crash|freeze|minor bugs|application reliability|unresponsive)\b/iu.test(
        context,
      )
    ) {
      return 'APPLICATION_RELIABILITY';
    }

    return `GENERIC:${this.canonicalizeOpportunityTitle(candidate.title).toLowerCase()}`;
  }

  /** Returns true only when both records belong to the same concrete family. */
  private haveCompatibleOpportunityFamilies(
    first: NormalizedCandidate,
    second: NormalizedCandidate,
  ): boolean {
    return (
      this.resolveOpportunityFamily(first) ===
      this.resolveOpportunityFamily(second)
    );
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

      const mergedProblem = preferred.problem ?? secondary.problem;
      const mergedNeed = this.selectMergedDescriptor(
        preferred.need,
        secondary.need,
      );
      const mergedSolutionArea = this.selectMergedDescriptor(
        preferred.solutionArea,
        secondary.solutionArea,
      );
      const alignedDescriptors = this.deriveAlignedDescriptors(
        preferred.title,
        mergedProblem,
        mergedNeed,
        mergedSolutionArea,
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
        severity: this.shouldAggregateFrequency(preferred, secondary)
          ? this.selectHigherSeverity(preferred.severity, secondary.severity)
          : preferred.severity,
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

    /*
     * The same verbatim evidence is persisted in multiple NLP projections
     * (problem, need, recurring problem, and opportunity). Treat those records
     * as one opportunity before applying family compatibility rules so the
     * ranking output does not expose duplicate alternatives for one complaint.
     */
    const firstEvidence = new Set(
      first.evidenceSamples.map((sample) =>
        this.normalizeEvidenceSample(sample),
      ),
    );
    const hasExactSharedEvidence = second.evidenceSamples.some((sample) =>
      firstEvidence.has(this.normalizeEvidenceSample(sample)),
    );

    if (hasExactSharedEvidence) {
      return true;
    }

    if (!this.haveCompatibleOpportunityFamilies(first, second)) {
      return false;
    }

    const hasAtomicEvidenceMatch = first.evidenceSamples.some((firstSample) =>
      second.evidenceSamples.some((secondSample) =>
        matchEvidenceToAtomicProblem(firstSample, secondSample).matched,
      ),
    );
    if (
      first.evidenceSamples.length > 0 &&
      second.evidenceSamples.length > 0 &&
      !hasAtomicEvidenceMatch
    ) {
      return false;
    }

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
    const mergedEvidence = this.deduplicateEvidenceSamples([
      ...first.evidenceSamples,
      ...second.evidenceSamples,
    ]);

    if (!this.shouldAggregateFrequency(first, second)) {
      return this.boundFrequencyToIndependentEvidence(
        Math.max(first.frequency, second.frequency),
        mergedEvidence,
      );
    }

    return this.boundFrequencyToIndependentEvidence(
      first.frequency + second.frequency,
      mergedEvidence,
    );
  }

  /**
   * Prevents model-estimated frequency from exceeding independently retained
   * evidence excerpts.
   *
   * The ranking response exposes frequency as an auditable evidence count.
   * Therefore a candidate with one unique quote cannot be scored or displayed
   * as supported unless at least one independently verified excerpt is retained.
   */
  private boundFrequencyToIndependentEvidence(
    _reportedFrequency: number,
    evidenceSamples: readonly string[],
  ): number {
    /*
     * The AI may cluster semantically equivalent complaints, but it must not
     * invent how many users reported the problem. Frequency is therefore the
     * number of independently retained evidence excerpts after deterministic
     * normalization and duplicate removal.
     */
    return this.deduplicateEvidenceSamples(evidenceSamples).length;
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

    const hasAtomicEvidenceMatch = first.evidenceSamples.some((firstSample) =>
      second.evidenceSamples.some((secondSample) =>
        matchEvidenceToAtomicProblem(firstSample, secondSample).matched,
      ),
    );
    if (!hasAtomicEvidenceMatch) {
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

  private selectMergedDescriptor(
    first: string | null,
    second: string | null,
  ): string | null {
    const values = [first, second]
      .map((value) => value?.replace(/\s+/gu, ' ').trim() ?? '')
      .filter(Boolean)
      .filter((value) => !GENERIC_LABELS.has(value.toLowerCase()));

    if (values.length === 0) return null;

    return values.sort((left, right) => {
      const leftGeneric = /\b(?:workflow diagnostics|guided decision support|evidence-grounded workflow diagnosis|human-reviewed recovery)\b/iu.test(left);
      const rightGeneric = /\b(?:workflow diagnostics|guided decision support|evidence-grounded workflow diagnosis|human-reviewed recovery)\b/iu.test(right);
      if (leftGeneric !== rightGeneric) return leftGeneric ? 1 : -1;
      return right.length - left.length;
    })[0] ?? null;
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
    selectedDomainTerms: readonly string[],
    selectedDomains: readonly SelectedDomainRankingInput[],
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
    const domainRelevanceScores = this.calculateDomainRelevanceScores(
      candidate,
      selectedDomains,
    );
    const matchedDomainNames = Object.entries(domainRelevanceScores)
      .filter(([, score]) => score >= MIN_SELECTED_DOMAIN_RELEVANCE)
      .sort((left, right) => right[1] - left[1])
      .map(([name]) => name);
    const selectedDomainRelevanceScore =
      selectedDomains.length > 0
        ? Math.max(0, ...Object.values(domainRelevanceScores))
        : this.calculateSelectedDomainRelevance(candidate, selectedDomainTerms);

    const weightedScore =
      (frequencyScore * 0.13 +
        severityScore * 0.07 +
        evidenceScore * 0.13 +
        directEvidenceRatio * 0.12 +
        evidenceQualityScore * 0.17 +
        evidenceReliabilityScore * 0.16 +
        specificityScore * 0.06 +
        feasibilityScore * 0.05 +
        localRelevanceScore * 0.02 +
        evidenceTypeScore * 0.03 +
        noveltyScore * 0.02 +
        businessValueScore * 0.02 +
        marketGapScore * 0.01 +
        competitionScore * 0.005 +
        (1 - technicalRiskScore) * 0.005) *
        0.84 +
      selectedDomainRelevanceScore * 0.16;

    /*
     * Historical diversity is a tie-breaker, not a substitute for evidence.
     * A problem family with two or more distinct retained reports must not lose
     * primarily because a one-off direction is more novel. Keep a small
     * diversity penalty for genuinely repeated ideas, but protect recurrent
     * evidence clusters from the old 0.55-0.72 score collapse.
     */
    const retainedEvidenceCount = this.deduplicateEvidenceSamples(
      candidate.evidenceSamples,
    ).length;
    const hasEvidenceRecurrence =
      candidate.frequency >= 2 || retainedEvidenceCount >= 2;
    const historicalDiversityMultiplier =
      previousIdeaTexts.length === 0
        ? 1
        : hasEvidenceRecurrence
          ? noveltyScore < 0.2
            ? 0.9
            : noveltyScore < 0.35
              ? 0.95
              : 1
          : noveltyScore < 0.2
            ? 0.75
            : noveltyScore < 0.35
              ? 0.84
              : noveltyScore < 0.5
                ? 0.93
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

    const offSelectedDomain =
      selectedDomains.length > 0
        ? matchedDomainNames.length === 0
        : selectedDomainTerms.length > 0 &&
          selectedDomainRelevanceScore < MIN_SELECTED_DOMAIN_RELEVANCE;

    if (offSelectedDomain) {
      disqualificationReasons.push('OFF_SELECTED_DOMAIN');
    }

    const eligibilityPenalty =
      disqualificationReasons.length > 0 ? INELIGIBLE_SELECTION_PENALTY : 0;
    const finalScore = this.round(
      Math.max(
        0,
        baseScore -
          confidencePenalty -
          eligibilityPenalty -
          (offSelectedDomain ? OFF_DOMAIN_SELECTION_PENALTY : 0),
      ),
    );

    if (finalScore < MIN_STRICT_OPPORTUNITY_SCORE) {
      disqualificationReasons.push('LOW_OPPORTUNITY_SCORE');
    }

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
      matchedDomainNames,
      domainRelevanceScores,
      selectionEligible: disqualificationReasons.length === 0,
      disqualificationReasons,
    };
  }

  /**
   * Measures whether the candidate belongs to at least one domain explicitly
   * selected by the user. Evidence-first candidates do not carry domainName,
   * so the decision is grounded in their own problem text and evidence.
   *
   * Exact multi-word domain/keyword phrases are deliberately strong. Generic
   * software words are ignored so an unrelated GitHub issue cannot win merely
   * because it contains words such as "system", "application", or "platform".
   */
  private calculateDomainRelevanceScores(
    candidate: NormalizedCandidate,
    selectedDomains: readonly SelectedDomainRankingInput[],
  ): Readonly<Record<string, number>> {
    if (selectedDomains.length === 0) {
      return {};
    }

    const coreCandidate = this.buildDomainSemanticCandidate(candidate, false);
    const contextCandidate = this.buildDomainSemanticCandidate(candidate, true);
    const semanticScores = new Map<string, number>();
    const contextScores = new Map<string, number>();

    for (const domain of selectedDomains) {
      const terms = this.expandDomainSemanticTerms(domain);
      semanticScores.set(
        domain.name,
        this.passesSelectedDomainContextGuard(domain.name, coreCandidate)
          ? this.calculateSelectedDomainRelevance(coreCandidate, terms)
          : 0,
      );
      contextScores.set(
        domain.name,
        this.passesSelectedDomainContextGuard(domain.name, contextCandidate)
          ? this.calculateSelectedDomainRelevance(contextCandidate, terms)
          : 0,
      );
    }

    const strongestSemantic = Math.max(0, ...semanticScores.values());
    const rawDomainName = this.readRawCandidateDomainName(candidate.raw);
    const output: Record<string, number> = {};

    for (const domain of selectedDomains) {
      const semantic = semanticScores.get(domain.name) ?? 0;
      const context = contextScores.get(domain.name) ?? 0;
      const contextGuardPassed = this.passesSelectedDomainContextGuard(
        domain.name,
        coreCandidate,
      );
      const explicit =
        contextGuardPassed &&
        this.normalizeDomainName(rawDomainName) ===
          this.normalizeDomainName(domain.name);
      let score = semantic;

      if (!contextGuardPassed) {
        output[domain.name] = 0;
        continue;
      }

      if (semantic < MIN_SELECTED_DOMAIN_RELEVANCE) {
        score = Math.max(
          score,
          context *
            (strongestSemantic < MIN_SELECTED_DOMAIN_RELEVANCE ? 0.62 : 0.38),
        );
      }

      if (explicit) {
        if (
          semantic >= 0.16 ||
          strongestSemantic < MIN_SELECTED_DOMAIN_RELEVANCE
        ) {
          score = Math.max(score, 0.72);
        } else {
          score = Math.max(score, 0.18);
        }
      }

      output[domain.name] = this.round(Math.min(1, score));
    }

    return output;
  }

  private buildDomainSemanticCandidate(
    candidate: NormalizedCandidate,
    contextOnly: boolean,
  ): NormalizedCandidate {
    const evidenceSamples = candidate.evidenceSamples
      .map((sample) => {
        const marker = sample.match(/\bCommunity comment:\s*/iu);
        if (!marker || marker.index === undefined) {
          return contextOnly ? '' : sample;
        }

        const markerEnd = marker.index + marker[0].length;
        return contextOnly
          ? sample.slice(0, marker.index).trim()
          : sample.slice(markerEnd).trim();
      })
      .filter(Boolean);

    return {
      ...candidate,
      title: contextOnly ? '' : candidate.title,
      problem: contextOnly ? null : candidate.problem,
      need: contextOnly ? null : candidate.need,
      solutionArea: contextOnly ? null : candidate.solutionArea,
      evidenceSamples,
    };
  }

  private expandDomainSemanticTerms(
    domain: SelectedDomainRankingInput,
  ): string[] {
    const normalizedName = this.normalizeDomainName(domain.name);
    const aliases: string[] = [];

    if (/^(?:finance|financial services|fintech)$/u.test(normalizedName)) {
      aliases.push(
        'finance',
        'financial',
        'bank',
        'banking',
        'payment',
        'payments',
        'card',
        'credit',
        'debit',
        'loan',
        'cash',
        'accounting',
        'invoice',
        'expense',
        'budget',
        'payroll',
        'reconciliation',
      );
    }

    if (/^(?:e commerce|ecommerce|online retail|retail)$/u.test(normalizedName)) {
      aliases.push(
        'e commerce',
        'ecommerce',
        'marketplace',
        'buyer',
        'seller',
        'checkout',
        'shopping cart',
        'cart',
        'order',
        'orders',
        'refund',
        'storefront',
        'paypal',
      );
    }

    if (/^(?:artificial intelligence|ai|machine learning)$/u.test(normalizedName)) {
      aliases.push(
        'artificial intelligence',
        'ai',
        'ai model',
        'ai assistant',
        'ai chatbot',
        'ai application',
        'generative ai',
        'machine learning',
        'large language model',
        'llm',
        'chatgpt',
        'prompt',
        'chatbot',
        'computer vision',
        'natural language processing',
      );
    }

    if (/^(?:manufacturing|industrial manufacturing)$/u.test(normalizedName)) {
      aliases.push(
        'manufacturing',
        'factory',
        'assembly line',
        'production line',
        'industrial equipment',
        'machinery',
        'shop floor',
        'quality control',
        'predictive maintenance',
        'manufacturing supply chain',
        'factory automation',
      );
    }

    if (/^(?:environment|environmental technology|environmental)$/u.test(normalizedName)) {
      aliases.push(
        'environmental monitoring',
        'environmental compliance',
        'pollution monitoring',
        'air quality',
        'water quality',
        'waste management',
        'recycling',
        'emissions',
        'carbon footprint',
        'sustainability',
        'ecosystem monitoring',
        'conservation',
        'biodiversity',
        'environmental impact',
      );
    }

    return [...new Set([domain.name, ...domain.keywords, ...aliases])];
  }

  private passesSelectedDomainContextGuard(
    domainName: string,
    candidate: NormalizedCandidate,
  ): boolean {
    const normalizedDomain = this.normalizeDomainName(domainName);
    const text = this.normalizeDomainName(
      [
        candidate.title,
        candidate.problem,
        candidate.need,
        candidate.solutionArea,
        ...candidate.evidenceSamples,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    );

    if (/^(?:environment|environmental technology|environmental)$/u.test(normalizedDomain)) {
      return /\b(?:environmental monitoring|environmental compliance|pollution|air quality|water quality|waste management|recycling|emissions?|carbon footprint|sustainability|ecosystem|conservation|biodiversity|environmental impact|climate risk|climate adaptation)\b/iu.test(
        text,
      );
    }

    if (/^(?:tourism|travel|travel tourism)$/u.test(normalizedDomain)) {
      const explicitTourismAnchor =
        /\b(?:tourism|tourism app|tourism application|tourism platform|tourism system|travel app|travel application|travel platform|tourist app|tourist service|tourism service)\b/iu.test(
          text,
        );
      const tourismWorkflowAnchor =
        /\b(?:travel booking|booking|reservation|tour itinerary|itinerary|tour operator|tour package|visitor management|destination management|travel inventory|hotel booking|guest booking|tourist service|tourism service|excursion booking)\b/iu.test(
          text,
        );
      const genericTechnicalFailure =
        /\b(?:visual studio|vsto|outofmemoryexception|out of memory|stack trace|exception from hresult|excel workbook|worksheet|module|range\(|runtime|compiler|memory error|ram|cpu)\b/iu.test(
          text,
        );
      const tourismOperationalFailure =
        /\b(?:booking|reservation|itinerary|tour|visitor|destination|hotel|guest|excursion)\b[^.!?]{0,120}\b(?:fail|failed|failure|error|blocked|missing|duplicate|wrong|unable|cannot|can['’]?t|delay|cancel|canceled|cancelled)\b/iu.test(
          text,
        ) ||
        /\b(?:fail|failed|failure|error|blocked|missing|duplicate|wrong|unable|cannot|can['’]?t|delay|cancel|canceled|cancelled)\b[^.!?]{0,120}\b(?:booking|reservation|itinerary|tour|visitor|destination|hotel|guest|excursion)\b/iu.test(
          text,
        );

      return (
        explicitTourismAnchor ||
        tourismOperationalFailure ||
        (tourismWorkflowAnchor && !genericTechnicalFailure)
      );
    }

    if (/^(?:cybersecurity|cyber security|information security)$/u.test(normalizedDomain)) {
      return /\b(?:cybersecurity|cyber security|authentication|two[- ]factor|2fa|mfa|oauth|identity access|credential|authorization|access control|security policy|threat|vulnerabilit|breach|phishing|malware|encryption|token isolation|password security|privacy)\b/iu.test(
        text,
      );
    }

    if (/^(?:education|edtech|educational technology)$/u.test(normalizedDomain)) {
      return /\b(?:student|teacher|coursework|assignment|grading|classroom|lesson|curriculum|homework|learning platform|learning management|education workflow|school|university|course material)\b/iu.test(
        text,
      );
    }

    if (/^(?:legaltech|legal tech|legal technology)$/u.test(normalizedDomain)) {
      return /\b(?:legal research|legal document|contract|case management|case law|court|attorney|lawyer|compliance workflow|legal workflow|legaltech|law database)\b/iu.test(
        text,
      );
    }

    if (!/^(?:manufacturing|industrial manufacturing)$/u.test(normalizedDomain)) {
      return true;
    }

    const industrialAnchor =
      /\b(?:factory|factories|assembly line|production line|industrial equipment|machinery|shop floor|quality control|predictive maintenance|supply chain|warehouse|cnc|oee|plant floor|manufacturing plant|factory automation)\b/iu.test(
        text,
      );
    const figurativeManufacturing =
      /\bmanufactur(?:e|ed|ing)\s+(?:evidence|claims?|story|stories|results?|data|narrative|proof|consensus|controversy|retrospective)\b/iu.test(
        text,
      );

    return industrialAnchor || (!figurativeManufacturing && !/\bmanufacturing\b/iu.test(text));
  }

  private readRawCandidateDomainName(value: Prisma.JsonValue): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }

    const rawDomain = (value as Prisma.JsonObject).domainName;
    return typeof rawDomain === 'string' ? rawDomain.trim() : '';
  }

  private normalizeDomainName(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private calculateSelectedDomainRelevance(
    candidate: NormalizedCandidate,
    selectedDomainTerms: readonly string[],
  ): number {
    if (selectedDomainTerms.length === 0) return 1;

    const normalize = (value: string): string =>
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

    const haystack = normalize(
      [
        candidate.title,
        candidate.problem,
        candidate.need,
        candidate.solutionArea,
        ...candidate.evidenceSamples,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    );

    if (!haystack) return 0;

    const genericTokens = new Set([
      'app',
      'application',
      'applications',
      'software',
      'system',
      'systems',
      'platform',
      'platforms',
      'service',
      'services',
      'dashboard',
      'analytics',
      'monitoring',
      'management',
      'integration',
      'automation',
      'smart',
      'user',
      'users',
    ]);

    let best = 0;

    for (const rawTerm of selectedDomainTerms) {
      const term = normalize(rawTerm);
      if (!term || (term.length < 3 && term !== 'ai')) continue;

      const tokens = term
        .split(' ')
        .filter(
          (token) =>
            (token === 'ai' || token.length >= 3) && !genericTokens.has(token),
        );
      if (tokens.length === 0) continue;

      if (term.includes(' ') && haystack.includes(term)) {
        best = Math.max(best, tokens.length >= 2 ? 1 : 0.8);
        continue;
      }

      const matchedTokens = tokens.filter((token) =>
        new RegExp(`(?:^|\\s)${this.escapeRegExp(token)}(?:$|\\s)`, 'u').test(
          haystack,
        ),
      ).length;
      const ratio = matchedTokens / tokens.length;

      if (matchedTokens >= 2) {
        best = Math.max(best, Math.min(0.9, 0.45 + ratio * 0.45));
      } else if (matchedTokens === 1 && tokens.length === 1) {
        best = Math.max(best, 0.72);
      }
    }

    return this.round(best);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  /**
   * Detects evidence that is primarily a repository implementation blueprint.
   * Such evidence can be retained for diagnostics, but it cannot independently
   * qualify a market opportunity because technical detail is not equivalent to
   * independent user demand.
   */
  private containsSolutionSpecificationEvidence(
    candidate: NormalizedCandidate,
  ): boolean {
    return candidate.evidenceSamples.some((sample) => {
      const normalized = sample.toLowerCase();
      const patterns: readonly RegExp[] = [
        /\bproposed implementation\b/iu,
        /\bfiles to modify(?:\/create)?\b/iu,
        /\bfrontend components?\b/iu,
        /\bexpected impact\b/iu,
        /\bcreate\s+`?(?:app|src|lib|components?|tests?)\//iu,
        /\b(?:api tests?|e2e tests?|unit tests?|test fixtures?)\b/iu,
        /\b(?:route\.js|manager\.js|service\.js|spec\.js|config\.js)\b/iu,
        /(?:^|\n)\s*[-*]\s*\[[ x]\]/iu,
      ];
      const signalCount = patterns.filter((pattern) =>
        pattern.test(normalized),
      ).length;

      return signalCount >= 3 || (normalized.length >= 900 && signalCount >= 2);
    });
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
      candidate.evidenceSamples.length >=
        MIN_STRICT_INDEPENDENT_EVIDENCE_COUNT &&
      directEvidenceRatio >= 0.6 &&
      evidenceQualityScore >= MIN_STRICT_EVIDENCE_QUALITY;

    if (this.containsSolutionSpecificationEvidence(candidate)) {
      reasons.push('SOLUTION_SPECIFICATION_EVIDENCE');
    }

    if (evidenceQualityScore < MIN_STRICT_EVIDENCE_QUALITY) {
      reasons.push('LOW_EVIDENCE_QUALITY');
    }

    if (supportScore < 0.36 && !hasConcreteMultiSampleEvidence) {
      reasons.push('INSUFFICIENT_SUPPORT');
    }

    if (
      candidate.evidenceSamples.length < MIN_STRICT_INDEPENDENT_EVIDENCE_COUNT
    ) {
      reasons.push('INSUFFICIENT_EVIDENCE_COUNT');
    }

    if (
      nlpConfidence < LOW_NLP_CONFIDENCE_THRESHOLD &&
      evidenceReliabilityScore < MIN_LOW_CONFIDENCE_RELIABILITY &&
      !hasConcreteMultiSampleEvidence
    ) {
      reasons.push('LOW_CONFIDENCE_REQUIRES_STRONGER_EVIDENCE');
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
      /(?:invoice|expense|reimbursement|accounts payable|accounts receivable).{0,140}(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck)|(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck).{0,140}(?:invoice|expense|reimbursement|accounts payable|accounts receivable)/iu.test(
        normalized,
      )
    ) {
      return 'Invoice and Expense Processing Friction';
    }

    if (
      /(?:accounting|bookkeeping|reconciliation|ledger|cash flow|financial close).{0,140}(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck|data loss)|(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck|data loss).{0,140}(?:accounting|bookkeeping|reconciliation|ledger|cash flow|financial close)/iu.test(
        normalized,
      )
    ) {
      return 'Financial Reconciliation and Accounting Friction';
    }

    if (
      /(?:payroll|procurement|purchase order|vendor approval|supplier approval).{0,140}(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck)|(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck).{0,140}(?:payroll|procurement|purchase order|vendor approval|supplier approval)/iu.test(
        normalized,
      )
    ) {
      return 'Payroll and Procurement Workflow Friction';
    }

    if (
      /(?:approval workflow|administrative workflow|administrative process|back office|manual data entry).{0,140}(?:slow|delay|delayed|manual|error|failed|bottleneck|rework)|(?:slow|delay|delayed|manual|error|failed|bottleneck|rework).{0,140}(?:approval workflow|administrative workflow|administrative process|back office|manual data entry)/iu.test(
        normalized,
      )
    ) {
      return 'Administrative Back-Office Workflow Friction';
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
    const runtimeSafeNormalized = normalized
      .replace(
        /\b(?:not|never|without|no)\s+(?:actually\s+)?(?:crash(?:es|ed|ing)?|freez(?:e|es|ing)|frozen)\b/giu,
        ' ',
      )
      .replace(
        /\b(?:keyboard\s+(?:appears?|feels?)\s+frozen|focus\s+(?:remains|stays|is)\s+(?:on|trapped|stuck)|keystrokes?\s+(?:are\s+)?(?:captured|consumed)|keyboard\s+input\s+(?:is\s+)?(?:captured|consumed)|type[- ]ahead|screen reader|no visible candidate)\b/giu,
        ' ',
      );

    const explicitRuntimeFailure =
      /\b(?:crash(?:ed|es|ing)?|freeze(?:s|ing|n)?|hang(?:s|ing)?|stuck|unresponsive|terminated|unexpectedly closes?|won['’]?t open|doesn['’]?t start|keeps? restarting|infinite loop|lost progress|state loss|session (?:lost|expired|stuck)|rollback|restore failed|data (?:lost|missing)|memory spike|out of memory|unhandled exception|runtime failure)\b/iu.test(
        runtimeSafeNormalized,
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
      /(?:streaming pipeline|streaming data|data pipeline)/iu.test(text) &&
      /(?:stale|skewed|incorrect|wrong|corrupt|quietly serving|silently serving)/iu.test(
        text,
      )
    ) {
      return 'Streaming Data Integrity and Staleness Failures';
    }

    if (
      /(?:keyboard\s+(?:appears?|feels?)\s+frozen|focus\s+(?:remains|stays|is)\s+(?:on|trapped|stuck)|keystrokes?\s+(?:are\s+)?(?:captured|consumed)|keyboard\s+input\s+(?:is\s+)?(?:captured|consumed)|type[- ]ahead|screen reader|no visible candidate)/iu.test(
        text,
      )
    ) {
      return 'Accessibility Focus and Keyboard Navigation Failures';
    }

    if (
      /(?:can(?:not|['’]?t)|unable to)\s+(?:access|login|log in|sign in|log into|sign into)\s+(?:my|the|this)?\s*account|locked out(?: of)?\s+(?:my|the|this)?\s*account/iu.test(
        text,
      )
    ) {
      return 'Login and Account Access Failures';
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

    if (
      /(?:invoice|expense|reimbursement|accounts payable|accounts receivable).{0,140}(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck)|(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck).{0,140}(?:invoice|expense|reimbursement|accounts payable|accounts receivable)/iu.test(
        text,
      )
    ) {
      return 'Invoice and Expense Processing Friction';
    }

    if (
      /(?:accounting|bookkeeping|reconciliation|ledger|cash flow|financial close).{0,140}(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck|data loss)|(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck|data loss).{0,140}(?:accounting|bookkeeping|reconciliation|ledger|cash flow|financial close)/iu.test(
        text,
      )
    ) {
      return 'Financial Reconciliation and Accounting Friction';
    }

    if (
      /(?:payroll|procurement|purchase order|vendor approval|supplier approval).{0,140}(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck)|(?:slow|delay|delayed|missing|duplicate|mismatch|manual|error|failed|bottleneck).{0,140}(?:payroll|procurement|purchase order|vendor approval|supplier approval)/iu.test(
        text,
      )
    ) {
      return 'Payroll and Procurement Workflow Friction';
    }

    if (
      /(?:approval workflow|administrative workflow|administrative process|back office|manual data entry).{0,140}(?:slow|delay|delayed|manual|error|failed|bottleneck|rework)|(?:slow|delay|delayed|manual|error|failed|bottleneck|rework).{0,140}(?:approval workflow|administrative workflow|administrative process|back office|manual data entry)/iu.test(
        text,
      )
    ) {
      return 'Administrative Back-Office Workflow Friction';
    }

    const runtimeSafeText = text
      .replace(
        /\b(?:not|never|without|no)\s+(?:actually\s+)?(?:crash(?:es|ed|ing)?|freez(?:e|es|ing)|frozen)\b/giu,
        ' ',
      )
      .replace(
        /\b(?:keyboard\s+(?:appears?|feels?)\s+frozen|focus\s+(?:remains|stays|is)\s+(?:on|trapped|stuck)|keystrokes?\s+(?:are\s+)?(?:captured|consumed)|keyboard\s+input\s+(?:is\s+)?(?:captured|consumed)|type[- ]ahead|screen reader|no visible candidate)\b/giu,
        ' ',
      );

    if (/(?:crash|freeze|broken|bug|error)/iu.test(runtimeSafeText)) {
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
    if (this.containsSolutionSpecificationEvidence(candidate)) {
      return 0.1;
    }

    const evidenceText = candidate.evidenceSamples.join(' ');
    const candidateText = [candidate.title, candidate.problem, evidenceText]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const titleWords = candidate.title.split(/\s+/u).filter(Boolean).length;
    const workflowBonus =
      /download|upload|navigation|login|activation|access|assignment|grade|document|sync|data|notification|recovery|payment/iu.test(
        candidateText,
      )
        ? 0.3
        : 0;

    const rawSpecificity =
      0.35 + Math.min(titleWords / 8, 0.35) + workflowBonus;

    /*
     * One report can describe a concrete symptom, but it cannot establish the
     * underlying technical cause with maximum certainty. Capping specificity
     * prevents a short, detailed complaint from receiving 100/100 merely
     * because the generated title contains diagnostic terminology.
     */
    const singleEvidenceCap = candidate.evidenceSamples.length === 1 ? 0.78 : 1;
    const symptomWithoutVerifiedCause =
      /\b(?:error|fails?|failure|cannot|unable|blocked|wrong|incorrect|logs? out|asks? you to log back in)\b/iu.test(
        evidenceText,
      ) &&
      !/\b(?:root cause|caused by|confirmed|verified|stack trace|error code|token expired|invalid token|server log)\b/iu.test(
        evidenceText,
      );
    const causationCap = symptomWithoutVerifiedCause ? 0.72 : 1;

    return Math.min(1, rawSpecificity, singleEvidenceCap, causationCap);
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

    if (!ranked[0]?.selectionEligible) {
      warnings.push(
        `No opportunity reached the strict minimum score of ${(MIN_STRICT_OPPORTUNITY_SCORE * 100).toFixed(0)}/100. The selected direction is a LOW_EVIDENCE_FALLBACK and must remain a pilot hypothesis.`,
      );
    }

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

    const commentBody =
      normalized.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim() ?? null;
    if (commentBody && isNonActionableCommunityBanter(commentBody, 'COMMENT')) {
      return false;
    }
    if (
      /\bcrash[- ]course\b/iu.test(normalized) &&
      !/\b(?:app|application|software|process|service|server|client)\b[^.!?]{0,80}\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive|exception|segfault)\b/iu.test(
        normalized,
      )
    ) {
      return false;
    }

    const commentMatch = normalized.match(/\bCommunity comment:\s*(.+)$/iu);
    if (commentMatch?.[1]) {
      const kind = classifyDirectCommunityEvidence(commentMatch[1], 'COMMENT');
      if (kind === 'GENERAL_COMMENTARY' || kind === 'USER_QUESTION' || kind === 'NONE') {
        return false;
      }
      if (kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST') {
        return true;
      }
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