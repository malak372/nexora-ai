export type CommunityAiEvidenceClassification =
  | 'DIRECT_PROBLEM'
  | 'SUPPORTING_SIGNAL'
  | 'UNRELATED';

export type CommunityAiEvidenceTriage = {
  readonly evidenceId: string;
  readonly classification: CommunityAiEvidenceClassification;
  readonly confidence: number;
  readonly reason: string;
  readonly problemFamily: string | null;
  readonly verifiedByDeterministicGuard: boolean;
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

  /** AiModel database identifier that produced the accepted response. */
  readonly modelId: string | null;

  /** Provider-side model identifier used for diagnostics and monitoring. */
  readonly apiModelId: string | null;

  /** Number of domain-level attempts required before acceptance. */
  readonly attemptCount: number;

  readonly aiAttempted: boolean;
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
};