export type RequestCollectionSourceFocus =
  | 'REVIEWS'
  | 'FORUMS'
  | 'TECHNICAL'
  | 'NEWS'
  | 'PRODUCT_DISCOVERY';

export type RequestCollectionDomainSelectionMode = 'EXISTING' | 'NEW';

export type RequestIntentMode = 'EXPLICIT_PROBLEM' | 'DISCOVERY_INTENT';

export type RequestIntentInterpretation = {
  /** AI-owned interpretation of whether the free text actually states a problem. */
  readonly mode: RequestIntentMode;
  /** Concise intent/context summary used to constrain discovery without becoming evidence. */
  readonly summary: string;
  /** Explicit problem extracted from the request only when the text truly states one. */
  readonly explicitProblem: string | null;
  /** Desired outcome/preference expressed by the requester, if any. */
  readonly desiredOutcome: string | null;
};

export type RequestCollectionSourcePlan = {
  readonly sourceKey: string;
  readonly queries: readonly string[];
  readonly routingHints: readonly string[];
  /** Domain lane that caused this source/query probe to run. Retrieval provenance only. */
  readonly discoveryDomainId?: string | null;
  readonly discoveryDomainName?: string | null;
  /** Candidate discovery lanes covered by this source call. Same collector may serve multiple domains. */
  readonly discoveryDomainIds?: readonly string[];
  readonly discoveryDomainNames?: readonly string[];
  /** Stable query-intent identifier used to trace evidence back to its search decision. */
  readonly queryIntentId?: string | null;
  /** Source budget tier. Every admin-enabled collector may run, but low-fit sources remain micro probes. */
  readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
  /** Canonical problem facets this query is attempting to validate. */
  readonly problemFacetIds?: readonly string[];
};

export type RequestCollectionDomainIdentity = {
  readonly actor: string;
  readonly object: string;
  readonly workflow: string;
  readonly failure: string;
};

/**
 * Canonical, problem-first interpretation created during the PREPARING phase
 * before domain resolution or collector execution.
 *
 * This profile exists only when PREPARING AI determines that the requester
 * actually stated an explicit problem. Free text that only expresses a goal,
 * preference, audience, or desired product direction remains request intent and
 * must not be promoted into a problem statement before evidence analysis.
 */
export type RequestCanonicalProblemProfile = {
  readonly actor: string;
  readonly object: string;
  readonly coreProblem: string;
  readonly workflow: string;
  /** Canonical request friction, kept separate from downstream consequences. */
  readonly friction?: string;
  readonly failureModes: readonly string[];
  readonly consequences: readonly string[];
  /** Safe deterministic aliases used only for retrieval recall, never as evidence claims. */
  readonly actorAliases?: readonly string[];
  readonly objectAliases?: readonly string[];
  readonly evidenceFacets?: readonly string[];
};

export type RequestCollectionPlan = {
  /**
   * Exact active domain selected by the AI from the current domain catalog.
   * Hidden and visible domains are both eligible. Null means the AI determined
   * that the request belongs to a new professional domain.
   */
  readonly selectedExistingDomainId?: string | null;

  /**
   * Whether the AI reused an existing active domain or proposed a new hidden
   * domain for the current request.
   */
  readonly domainSelectionMode?: RequestCollectionDomainSelectionMode;

  readonly suggestedDomainName: string | null;

  /**
   * Request-grounded semantic scopes that materially participate in the
   * described workflow but are not promoted to configured domain rows.
   *
   * Example: a text-only Construction Management request may explicitly
   * involve Insurance and Equipment Rental. Those concepts must remain
   * available to retrieval, recovery, analytics, and prompt grounding even
   * when they are not present in the admin domain catalog. They are retrieval
   * facets only; they are never evidence and never create domain records.
   */
  readonly inferredSecondaryScopes?: readonly string[];

  readonly requestIntent?: RequestIntentInterpretation;
  readonly domainIdentity?: RequestCollectionDomainIdentity;
  readonly problemProfile?: RequestCanonicalProblemProfile;
  readonly existingDomainMatchScore?: number;
  readonly searchQueries: readonly string[];
  /**
   * AI-proposed practitioner/research terminology used only to improve recall.
   * These phrases are retrieval vocabulary, never evidence and never a problem
   * claim. Runtime queries anchor them back to the immutable requester scope.
   */
  readonly retrievalVocabulary?: readonly string[];
  readonly evidenceTargets: readonly string[];
  readonly intentConcepts: readonly string[];
  readonly sourceFocus: readonly RequestCollectionSourceFocus[];
  readonly selectedSourceKeys?: readonly string[];
  readonly sourcePlans?: readonly RequestCollectionSourcePlan[];
  readonly confidence: number;
  readonly aiUsed: boolean;
  readonly fallbackUsed: boolean;
};
