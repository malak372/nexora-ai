import type { Prisma } from '@prisma/client';

import type { IndependentEvidence } from './independent-evidence.type';

/**
 * Supported evidence categories used while ranking product opportunities.
 *
 * @author Malak
 */
export const IDEA_OPPORTUNITY_EVIDENCE_TYPES = {
  PROBLEM: 'PROBLEM',
  NEED: 'NEED',
  FEATURE_REQUEST: 'FEATURE_REQUEST',
  OPPORTUNITY: 'OPPORTUNITY',
} as const;

/** Evidence category attached to a ranked opportunity. */
export type IdeaOpportunityEvidenceType =
  (typeof IDEA_OPPORTUNITY_EVIDENCE_TYPES)[keyof typeof IDEA_OPPORTUNITY_EVIDENCE_TYPES];

/**
 * One normalized and scored opportunity discovered from persisted NLP output.
 *
 * Scores use a zero-to-one scale so the ranking contract remains independent
 * from any AI-provider scoring convention.
 *
 * @author Malak
 */
export type RankedIdeaOpportunity = {
  readonly rank: number;
  readonly title: string;
  readonly problem: string | null;
  readonly need: string | null;
  readonly solutionArea: string | null;
  readonly evidenceType: IdeaOpportunityEvidenceType;
  readonly sourceIndex: number;
  readonly frequency: number;
  readonly severity: string | null;
  readonly evidenceSamples: readonly string[];
  readonly frequencyScore: number;
  readonly severityScore: number;
  readonly evidenceScore: number;
  readonly evidenceReliabilityScore: number;
  readonly weakEvidencePenalty: number;
  readonly specificityScore: number;
  readonly feasibilityScore: number;
  readonly localRelevanceScore: number;
  readonly noveltyScore: number;
  readonly businessValueScore: number;
  readonly marketGapScore: number;
  readonly competitionScore: number;
  readonly technicalRiskScore: number;
  readonly supportScore: number;
  readonly nlpConfidenceScore: number;
  readonly baseScore: number;
  readonly confidencePenalty: number;
  readonly finalScore: number;
  readonly matchedDomainNames?: readonly string[];

  /** Domain(s) supported by the verified problem semantics themselves. */
  readonly problemDomainNames?: readonly string[];

  /** Domain(s) supported by the verified workflow/product context around the problem. */
  readonly workflowDomainNames?: readonly string[];

  /** Primary problem domain used for downstream prompt/domain anchoring. */
  readonly primaryMatchedDomainName?: string | null;

  readonly domainRelevanceScores?: Readonly<Record<string, number>>;
  readonly problemDomainRelevanceScores?: Readonly<Record<string, number>>;
  readonly workflowDomainRelevanceScores?: Readonly<Record<string, number>>;

  /** Lexical/semantic match to the requester's explicit current description. */
  readonly requestIntentAlignmentScore?: number;

  /** Evidence score after bounded request-intent reranking. */
  readonly requestIntentAdjustedScore?: number;

  readonly selectionEligible: boolean;
  readonly disqualificationReasons: readonly string[];

  /** Auditable evidence provenance resolved from persisted collection records. */
  readonly independentEvidence?: readonly IndependentEvidence[];

  /** Number of independently verified complaints, requests, or reviews. */
  readonly verifiedIndependentEvidenceCount?: number;

  /** Number of distinct source platforms represented by verified direct evidence. */
  readonly verifiedIndependentSourceCount?: number;

  /** Total verified evidence items resolved for the candidate before problem-level filtering. */
  readonly verifiedEvidenceCount?: number;

  /** Direct-user evidence resolved for the candidate before problem-level filtering. */
  readonly verifiedDirectUserEvidenceCount?: number;

  /** Secondary evidence resolved for the candidate before problem-level filtering. */
  readonly verifiedSecondaryEvidenceCount?: number;

  /** Technical evidence resolved for the candidate before problem-level filtering. */
  readonly verifiedTechnicalEvidenceCount?: number;

  readonly verifiedQuestionEvidenceCount?: number;

  readonly verifiedObservationEvidenceCount?: number;

  readonly verifiedComplaintEvidenceCount?: number;

  readonly verifiedComplaintSourceCount?: number;

  readonly verifiedFeatureRequestEvidenceCount?: number;

  /** Distinct source platforms represented by all resolved candidate evidence. */
  readonly verifiedEvidenceSourceCount?: number;

  /**
   * Evidence that matches the final verified problem family, not merely the
   * selected domain. These counters are the source of truth for recurrence,
   * prompt evidence claims, and final idea wording.
   */
  readonly verifiedProblemMatchedEvidenceCount?: number;

  readonly verifiedProblemMatchedDirectUserEvidenceCount?: number;

  readonly verifiedProblemMatchedSecondaryEvidenceCount?: number;

  readonly verifiedProblemMatchedTechnicalEvidenceCount?: number;

  readonly verifiedProblemMatchedQuestionEvidenceCount?: number;

  readonly verifiedProblemMatchedObservationEvidenceCount?: number;

  readonly verifiedProblemMatchedComplaintEvidenceCount?: number;

  readonly verifiedProblemMatchedComplaintSourceCount?: number;

  readonly verifiedProblemMatchedFeatureRequestEvidenceCount?: number;

  /** Distinct direct-user source platforms represented by problem-matched evidence. */
  readonly verifiedProblemMatchedSourceCount?: number;

  /** Distinct source platforms represented by all problem-matched evidence kinds. */
  readonly verifiedProblemMatchedEvidenceSourceCount?: number;

  readonly relatedOpportunityBundle?: readonly {
    readonly rank: number;
    readonly title: string;
    readonly problem: string | null;
    readonly need: string | null;
    readonly solutionArea: string | null;
    readonly evidenceType: IdeaOpportunityEvidenceType;
    readonly evidenceSamples: readonly string[];
    readonly matchedDomainNames: readonly string[];
    readonly verifiedProblemMatchedEvidenceCount: number;
    readonly verifiedProblemMatchedDirectUserEvidenceCount: number;
    readonly verifiedProblemMatchedComplaintEvidenceCount: number;
    readonly verifiedProblemMatchedFeatureRequestEvidenceCount: number;
  }[];

  readonly raw: Prisma.JsonValue;
};

/**
 * Deterministic opportunity-ranking result stored in the generation context.
 *
 * @author Malak
 */
export type IdeaOpportunityRanking = {
  readonly selected: RankedIdeaOpportunity;
  readonly alternatives: readonly RankedIdeaOpportunity[];
  readonly evaluatedCount: number;
  readonly evidenceCoverage: number;

  /**
   * Human-readable explanation of why the selected candidate outranked the
   * alternatives. Intended for monitoring and administrator diagnostics.
   */
  readonly selectionReason: string;

  readonly qualityWarnings: readonly string[];
};
