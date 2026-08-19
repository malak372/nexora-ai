export type RequestCollectionSourceFocus =
  | 'REVIEWS'
  | 'FORUMS'
  | 'TECHNICAL'
  | 'NEWS'
  | 'PRODUCT_DISCOVERY';

export type RequestCollectionPlan = {
  readonly suggestedDomainName: string | null;
  readonly searchQueries: readonly string[];
  readonly evidenceTargets: readonly string[];
  readonly intentConcepts: readonly string[];
  readonly sourceFocus: readonly RequestCollectionSourceFocus[];
  readonly confidence: number;
  readonly aiUsed: boolean;
  readonly fallbackUsed: boolean;
};
