export type RequestCollectionSourceFocus =
  | 'REVIEWS'
  | 'FORUMS'
  | 'TECHNICAL'
  | 'NEWS'
  | 'PRODUCT_DISCOVERY';

export type RequestCollectionDomainSelectionMode = 'EXISTING' | 'NEW';

export type RequestCollectionSourcePlan = {
  readonly sourceKey: string;
  readonly queries: readonly string[];
  readonly routingHints: readonly string[];
  /** Domain lane that caused this source/query probe to run. Retrieval provenance only. */
  readonly discoveryDomainId?: string | null;
  readonly discoveryDomainName?: string | null;
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
 * The requester text is the source of truth. Explicit/inferred domains are
 * contextual constraints only and must never replace this problem profile.
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
  readonly domainIdentity?: RequestCollectionDomainIdentity;
  readonly problemProfile?: RequestCanonicalProblemProfile;
  readonly existingDomainMatchScore?: number;
  readonly searchQueries: readonly string[];
  readonly evidenceTargets: readonly string[];
  readonly intentConcepts: readonly string[];
  readonly sourceFocus: readonly RequestCollectionSourceFocus[];
  readonly selectedSourceKeys?: readonly string[];
  readonly sourcePlans?: readonly RequestCollectionSourcePlan[];
  readonly confidence: number;
  readonly aiUsed: boolean;
  readonly fallbackUsed: boolean;
};
