import {
  COMMUNITY_AI_EVIDENCE_NATURES,
  COMMUNITY_AI_PROBLEM_FAMILY_BASES,
  COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS,
  COMMUNITY_AI_SEMANTIC_ALIGNMENTS,
} from '../constants/community-ai-analysis.constants';

export type CommunityAiEvidenceKind =
  | 'USER_COMPLAINT'
  | 'OPERATIONAL_INCIDENT'
  | 'ACADEMIC_TECHNICAL_SIGNAL'
  | 'NEWS_REPORT'
  | 'MARKET_REPORT'
  | 'COMMUNITY_DISCUSSION'
  | 'UNKNOWN';

export type CommunityAiProviderEvidenceClassification =
  (typeof COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS)[number];

export type CommunityAiEvidenceClassification =
  | CommunityAiProviderEvidenceClassification
  | 'ANALOGOUS_WORKFLOW_SIGNAL'
  | 'UNADJUDICATED';

export type CommunityAiEvidenceVerdictState =
  | 'VALID_EVIDENCE_FOUND'
  | 'NO_VALID_EVIDENCE_FOUND'
  | 'EVIDENCE_ADJUDICATION_UNAVAILABLE';

export type CommunityAiAdjudicationFailureReason =
  | 'AI_TIMEOUT'
  | 'AI_EXECUTION_FAILED'
  | 'AI_VALIDATION_REJECTED'
  | 'AI_UNAVAILABLE'
  | 'AI_ABORTED'
  | 'AI_MISSING_VERDICT';

export type CommunityAiEvidenceNature =
  (typeof COMMUNITY_AI_EVIDENCE_NATURES)[number];

export type CommunityAiSemanticAlignment =
  (typeof COMMUNITY_AI_SEMANTIC_ALIGNMENTS)[number];

export type CommunityAiProblemFamilyBasis =
  (typeof COMMUNITY_AI_PROBLEM_FAMILY_BASES)[number];

export type CommunityAiEvidenceTriage = {
  readonly evidenceId: string;
  readonly classification: CommunityAiEvidenceClassification;
  readonly confidence: number;
  readonly reason: string;
  /** Neutral, evidence-native observed problem label. Never an editorial cause. */
  readonly problemFamily: string | null;
  /** AI-owned semantic decomposition used by the structural canonical guard. */
  readonly evidenceNature?: CommunityAiEvidenceNature;
  readonly domainAlignment?: CommunityAiSemanticAlignment;
  readonly problemAlignment?: CommunityAiSemanticAlignment;
  readonly familyBasis?: CommunityAiProblemFamilyBasis;
  readonly observedProblem?: string | null;
  readonly causalExplanation?: string | null;
  readonly matchedDomainNames?: readonly string[];
  /**
   * Historical field name retained for persistence/telemetry compatibility.
   * It now means the AI verdict passed non-semantic structural/provenance checks;
   * deterministic code no longer re-classifies the meaning of the evidence.
   */
  readonly verifiedByDeterministicGuard: boolean;
  /** Explicitly distinguishes a semantic verdict from transport/provider failure. */
  readonly adjudicationStatus?: 'ADJUDICATED' | 'UNADJUDICATED';
  readonly adjudicationFailureReason?: CommunityAiAdjudicationFailureReason | null;
  /** Provenance/claim kind kept separate from relevance classification. */
  readonly evidenceKind?: CommunityAiEvidenceKind;
};

/**
 * One evidence-grounded opportunity extracted by the community-analysis LLM.
 * Scores use a 0-100 scale because they are later consumed by deterministic
 * opportunity ranking.
 */
export type CommunityAiOpportunity = {
  /** Selected domain most directly supported by this opportunity. */
  readonly domainName: string;
  readonly title: string;
  readonly problem: string;
  readonly unmetNeed: string;
  readonly solutionArea: string;
  readonly affectedUsers: readonly string[];
  readonly evidenceSamples: readonly string[];
  readonly frequency: number;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly confidence: number;
  readonly problemImportance: number;
  /** True only when accepted evidence explicitly mentions the selected location. */
  readonly localEvidenceAvailable: boolean;
  /** Grounded quotes that explicitly support a local claim. */
  readonly localEvidenceSamples: readonly string[];
  /** Local relevance is capped when local evidence is unavailable. */
  readonly localRelevance: number;
  /** Deterministic evidence-to-opportunity grounding score on a 0-100 scale. */
  readonly groundingScore: number;
  readonly technicalFeasibility: number;
  readonly marketPotential: number;
  readonly innovationPotential: number;
  readonly risks: readonly string[];
};


export type CommunityAiAttemptStatus =
  | 'ACCEPTED'
  | 'EXECUTION_FAILED'
  | 'VALIDATION_REJECTED'
  | 'ABORTED'
  | 'TIMEOUT';

export type CommunityAiAttemptDiagnostic = {
  readonly attempt: number;
  readonly modelId: string | null;
  readonly apiModelId: string | null;
  readonly providerKey: string | null;
  readonly status: CommunityAiAttemptStatus;
  readonly durationMs: number;
  readonly reason: string | null;
  /** Safe provider-output telemetry; raw evidence and full model text are never persisted here. */
  readonly providerOpportunityCount?: number;
  readonly groundedOpportunityCount?: number;
  readonly candidateTitles?: readonly string[];
  readonly semanticGroundingRepairCount?: number;
};

export type CommunityAiDomainHypothesis = {
  readonly domainName: string;
  readonly title: string;
  readonly problem: string;
  readonly unmetNeed: string;
  readonly solutionArea: string;
  readonly confidence: number;
  readonly risks: readonly string[];
};

/** Structured result accepted from the community-analysis LLM. */
export type CommunityAiAnalysis = {
  readonly summary: string;
  readonly dominantProblems: readonly string[];
  readonly unmetNeeds: readonly string[];
  readonly opportunities: readonly CommunityAiOpportunity[];
  readonly overallConfidence: number;
  readonly qualityWarnings: readonly string[];

  /**
   * Distinguishes a real semantic "no evidence" verdict from a provider
   * outage/timeout where the raw corpus could not be adjudicated at all.
   */
  readonly evidenceVerdictState?: CommunityAiEvidenceVerdictState;

  /** AiModel database identifier that produced the accepted response. */
  readonly modelId: string | null;

  /** Provider-side model identifier used for diagnostics and monitoring. */
  readonly apiModelId: string | null;

  /** Number of domain-level attempts required before acceptance. */
  readonly attemptCount: number;

  readonly aiAttempted: boolean;
  /** True when at least one online evidence-triage batch returned usable classifications. */
  readonly triageAiSucceeded?: boolean;
  /** True only when online opportunity synthesis returned an accepted grounded opportunity. */
  readonly synthesisAiSucceeded?: boolean;
  readonly aiSucceeded: boolean;
  readonly fallbackUsed: boolean;
  readonly onlineAttemptCount: number;
  readonly executionFailureCount: number;
  readonly validationRejectedCount: number;
  readonly fallbackReason: string | null;
  readonly attemptDiagnostics: readonly CommunityAiAttemptDiagnostic[];
  readonly unvalidatedDomainHypotheses: readonly CommunityAiDomainHypothesis[];

  /**
   * AI semantic classification of the bounded raw collector corpus. Entries
   * are post-processed by deterministic request/workflow guards before they are
   * exposed as accepted triage labels.
   */
  readonly evidenceClassifications?: readonly CommunityAiEvidenceTriage[];

  /** Family proposed by the same online triage response that classified the full raw corpus. */
  readonly aiProposedProblemFamily?: string | null;

  /** Evidence ids proposed by that online triage response before deterministic verification. */
  readonly aiProposedProblemFamilyEvidenceIds?: readonly string[];

  /** Makes AI proposal versus deterministic verification/fallback ownership explicit. */
  readonly selectedProblemFamilySelectionSource?:
    | 'AI_SELECTED_PENDING_VERIFICATION'
    | 'AI_SELECTED_VERIFIED'
    | 'AI_CLUSTER_VERIFIED'
    | 'DETERMINISTIC_VERIFIED_FALLBACK'
    | 'AI_PROPOSAL_REJECTED'
    | null;

  /** Canonical problem-family identity selected from the verified evidence ledger. */
  readonly selectedProblemFamily?: string | null;

  /** Trusted evidence count for the selected family only (never the global ledger count). */
  readonly selectedProblemFamilyTrustedEvidenceCount?: number;

  /** Distinct external source count represented by trusted evidence for the selected family. */
  readonly selectedProblemFamilyDistinctSourceCount?: number;

  /** Canonical evidence ids that belong to the selected family. */
  readonly selectedProblemFamilyEvidenceIds?: readonly string[];

  /** Immutable family lock created after canonical evidence verification. */
  readonly canonicalProblemFamilyId?: string | null;
  readonly canonicalProblemFamilyLabel?: string | null;
  readonly canonicalProblemFamilyEvidenceIds?: readonly string[];
};