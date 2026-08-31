export type IdeaGenerationRequestMode =
  | 'TEXT_AND_DOMAINS'
  | 'TEXT_ONLY'
  | 'DOMAINS_ONLY'
  | 'NO_INPUT';

export type IdeaGenerationProblemFacetType =
  | 'WORKFLOW'
  | 'FAILURE'
  | 'CONSEQUENCE'
  | 'RISK'
  | 'REWORK'
  | 'DELAY'
  | 'COST'
  | 'ACCESS'
  | 'COORDINATION'
  | 'DATA_GAP'
  | 'VISIBILITY'
  | 'DECISION';

export type IdeaGenerationProblemFacet = {
  readonly id: string;
  readonly type: IdeaGenerationProblemFacetType;
  readonly statement: string;
};

export type IdeaGenerationCanonicalProblemSpec = {
  readonly mode: IdeaGenerationRequestMode;
  readonly actor: string | null;
  readonly actorAliases: readonly string[];
  readonly object: string | null;
  readonly objectAliases: readonly string[];
  readonly workflow: string | null;
  readonly friction: string | null;
  readonly failureModes: readonly string[];
  readonly consequences: readonly string[];
  readonly facets: readonly IdeaGenerationProblemFacet[];
  readonly explicitDomainIds: readonly string[];
  readonly inferredDomainId: string | null;
};

export type IdeaGenerationEvidenceState =
  | 'DIRECT_VALIDATED'
  | 'SUPPORTING_VALIDATED'
  | 'NO_VALID_EVIDENCE_FOUND'
  | 'EVIDENCE_ADJUDICATION_UNAVAILABLE';

export type IdeaGenerationCollectorTier =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'MICRO_PROBE';

export type IdeaGenerationCollectionPhase = 'INITIAL' | 'RECOVERY';
