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
};

export type RequestCollectionDomainIdentity = {
  readonly actor: string;
  readonly object: string;
  readonly workflow: string;
  readonly failure: string;
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
