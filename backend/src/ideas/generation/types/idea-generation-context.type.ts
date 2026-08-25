import { IdeaGenerationType, LanguageCode, Prisma } from '@prisma/client';

import type { JsonSchema } from '../../../prompts/types/json-schema.type';

import type { IdeaOwner } from '../../shared/types/idea-owner.type';

import type {
  AdvancedIdeaAiOutput,
  CoreIdeaAiOutput,
  IdeaAdvancedOutputKey,
  ParsedIdeaAiOutput,
} from './idea-ai-output.type';

import type { CommunityAiAnalysis } from './community-ai-analysis.type';
import type { IdeaGenerationPolicy } from './idea-generation-policy.type';
import type {
  IdeaOpportunityRanking,
  RankedIdeaOpportunity,
} from './idea-opportunity-ranking.type';
import type { RequestCollectionPlan } from './request-collection-plan.type';
import type {
  IdeaGenerationCanonicalProblemSpec,
  IdeaGenerationCollectionPhase,
  IdeaGenerationCollectorTier,
  IdeaGenerationEvidenceState,
  IdeaGenerationRequestMode,
} from './canonical-problem-spec.type';

/**
 * Data source selected for one generation run.
 *
 * The collector implementation is resolved in application code
 * using the stable source key. The collector itself is not stored
 * as a Prisma enum.
 *
 * @author Malak
 */
export type SelectedIdeaDataSource = {
  /**
   * Database identifier of the data-source configuration.
   */
  id: string;

  /**
   * Stable application key used to resolve the collector.
   */
  key: string;

  /**
   * Human-readable source name.
   */
  displayName: string;

  /**
   * Indicates whether the source may return post records.
   */
  supportsPosts: boolean;

  /**
   * Indicates whether the source may return comment records.
   */
  supportsComments: boolean;

  /**
   * Indicates whether the collector supports region metadata.
   */
  supportsRegion: boolean;

  /**
   * Indicates whether the collector supports language metadata.
   */
  supportsLanguage: boolean;
};

/**
 * Geographic and language parameters used by data collection.
 *
 * Language is stored as collection metadata and must not
 * automatically exclude community content unless the selected
 * collector explicitly supports language filtering.
 *
 * @author Malak
 */
export type IdeaGenerationLocation = {
  /**
   * Country selected for the generation request.
   */
  country: string;

  /**
   * Optional selected city.
   */
  city: string | null;

  /**
   * Optional selected region.
   */
  region: string | null;

  /**
   * Optional search radius in kilometres.
   */
  radiusKm: number | null;

  /**
   * Preferred generation and collection language metadata.
   */
  language: LanguageCode;
};

/**
 * Resolved collection-job information used by the pipeline.
 *
 * @author Malak
 */
export type IdeaGenerationCollectionResolution = {
  /**
   * Collection-job identifier.
   */
  collectionJobId: string;

  /**
   * Indicates whether an existing completed collection job was
   * reused instead of creating a new job.
   */
  reused: boolean;

  /**
   * Number of collected post records retained and analyzed by NLP.
   *
   * This may be lower than CollectionJob.totalPosts when filtering,
   * preprocessing, or quality validation excludes records.
   */
  totalPosts: number;

  /**
   * Number of collected comment records retained and analyzed by NLP.
   *
   * This may be lower than CollectionJob.totalComments when filtering,
   * preprocessing, or quality validation excludes records.
   */
  totalComments: number;
};

/**
 * Minimal normalized NLP data required by prompt building.
 *
 * Persisted NLP JSON may contain additional fields that are not
 * required by the idea-generation pipeline.
 *
 * @author Malak
 */
export type IdeaGenerationNlpContext = {
  /**
   * Persisted NLP-analysis identifier.
   */
  nlpAnalysisId: string;

  /**
   * Total number of analyzed post and comment texts.
   */
  totalTextsAnalyzed: number;

  /**
   * Number of analyzed posts.
   */
  totalPostsAnalyzed: number;

  /**
   * Number of analyzed comments.
   */
  totalCommentsAnalyzed: number;

  /**
   * Aggregated sentiment statistics.
   */
  sentimentStats: Prisma.JsonValue | null;

  /**
   * Extracted keyword data.
   */
  keywords: Prisma.JsonValue | null;

  /**
   * Extracted topic data.
   */
  topics: Prisma.JsonValue | null;

  /**
   * Recurring community problems.
   */
  recurringProblems: Prisma.JsonValue | null;

  /**
   * Extracted community needs.
   */
  extractedNeeds: Prisma.JsonValue | null;

  /**
   * Extracted feature requests.
   */
  featureRequests: Prisma.JsonValue | null;

  /**
   * Identified software opportunities.
   */
  opportunities: Prisma.JsonValue | null;

  /**
   * Additional generated insights.
   */
  insights: Prisma.JsonValue | null;

  /**
   * Data-quality metrics associated with the analysis.
   */
  dataQuality: Prisma.JsonValue | null;

  /**
   * Representative post samples.
   */
  samplePosts: Prisma.JsonValue | null;

  /**
   * Representative comment samples.
   */
  sampleComments: Prisma.JsonValue | null;

  /**
   * Indicates whether AI enhancement was used during analysis.
   */
  aiUsed: boolean;

  /**
   * Optional NLP confidence value.
   */
  confidence: number | null;
};

/**
 * Prompt information produced before calling the AI runtime.
 *
 * @author Malak
 */
export type IdeaGenerationPromptContext = {
  /**
   * Persisted prompt-history identifier.
   */
  promptHistoryId: string;

  /**
   * Complete rendered prompt text.
   */
  promptText: string;

  /**
   * Optional template hash used for traceability.
   */
  templateHash: string | null;

  /**
   * Estimated prompt input-token count.
   */
  estimatedInputTokens: number | null;

  /**
   * Stable name of the structured response schema used by the AI
   * runtime.
   */
  responseSchemaName: string;

  /**
   * Exact provider-neutral JSON schema resolved while building
   * the prompt.
   *
   * Keeping the schema in the generation context prevents the AI
   * execution stage from rebuilding the prompt and potentially
   * observing a newer active template or response contract.
   */
  responseSchema: JsonSchema;
};

/**
 * Mutable context shared across all idea-generation stages.
 *
 * The context is created once by the orchestrator and enriched
 * progressively by individual pipeline stages.
 *
 * Pipeline stages may return:
 * - The same modified context object.
 * - A new context object containing the updated values.
 *
 * @author Malak
 */

/**
 * Normal, non-error terminal outcome produced when collection and recovery
 * complete successfully but no recurring problem reaches the strict evidence
 * gate. Later AI-generation and persistence stages must be skipped.
 */
export type IdeaGenerationNoResultOutcome = {
  readonly code: 'NO_RECURRING_OPPORTUNITY';
  readonly message: string;
  readonly strongestSignalTitle: string | null;
  readonly independentEvidenceCount: number;
  readonly requiredIndependentEvidenceCount: number;
  readonly recoveryAttempts: number;
  readonly collectionJobIds: readonly string[];
};



/**
 * Metadata describing how the primary generation domain was resolved.
 * The orchestrator may use its bounded candidates to expand the search scope,
 * and ranking may use USER_SELECTED to preserve an explicit domain when a
 * supplied description points to a different domain.
 */
export type IdeaGenerationDomainResolutionTrace = {
  readonly source: string;
  readonly confidence: number;
  readonly selectedDomain: {
    readonly id: string;
    readonly name: string;
  };
  readonly matchedInterests: readonly string[];
  readonly reasons: readonly string[];
  readonly candidates: readonly {
    readonly domainId: string;
    readonly domainName: string;
    readonly score: number;
    readonly reasons: readonly string[];
  }[];
};

/** One concrete domain participating in a cross-domain generation request. */
export type SelectedGenerationDomain = {
  readonly id: string;
  readonly name: string;
  readonly keywords: readonly string[];
  readonly configuredKeywords?: readonly string[];
  /**
   * Request-derived search vocabulary for this run only.
   * These terms must never be persisted onto an existing visible domain.
   */
  readonly requestIntentKeywords?: readonly string[];
  readonly effectiveSearchKeywords?: readonly string[];
  /** True only when this domain was explicitly selected by the requester. */
  readonly isExplicitlySelected?: boolean;
};

/**
 * Evidence collected for one selected domain during a multi-domain run.
 *
 * Keeping this structure in the shared generation context allows later stages
 * to preserve domain attribution while still using one merged NLP analysis.
 * A domain may legitimately contain zero texts; in that case it can only be
 * presented to the AI as a validation hypothesis, not as observed evidence.
 *
 * @author Eman
 */
export type IdeaGenerationDomainEvidence = {
  /** Selected domain identifier. */
  readonly domainId: string;

  /** Human-readable selected domain name. */
  readonly domainName: string;

  /** Collection job that produced this domain evidence. */
  readonly collectionJobId: string;

  /** Indicates whether a compatible completed collection job was reused. */
  readonly reused: boolean;

  /** Total analyzed posts and comments for this domain. */
  readonly totalTextsAnalyzed: number;

  /** Total analyzed posts for this domain. */
  readonly totalPostsAnalyzed: number;

  /** Total analyzed comments for this domain. */
  readonly totalCommentsAnalyzed: number;

  /** True when at least one cleaned text is available as evidence. */
  readonly evidenceAvailable: boolean;

  /** Representative posts retained by the NLP pipeline. */
  readonly samplePosts: Prisma.JsonValue | null;

  /** Representative comments retained by the NLP pipeline. */
  readonly sampleComments: Prisma.JsonValue | null;
};

export type IdeaGenerationRawEvidenceItem = {
  readonly id: string;
  readonly sourceKey: string;
  readonly sourceType: 'POST' | 'COMMENT';
  readonly postId?: string;
  readonly title?: string | null;
  readonly text: string;
  readonly isComplaintEvidence?: boolean;
  readonly requiresAiSemanticTriage?: boolean;
  /** Retrieval provenance. These fields explain why this evidence was collected; they are never proof by themselves. */
  readonly discoveryDomainId?: string | null;
  readonly discoveryDomainName?: string | null;
  readonly queryIntentId?: string | null;
  readonly queryText?: string | null;
  readonly problemFacetIds?: readonly string[];
  readonly collectionPhase?: IdeaGenerationCollectionPhase;
  readonly sourceTier?: IdeaGenerationCollectorTier;
};


export type IdeaGenerationCanonicalEvidenceItem = {
  readonly id: string;
  readonly sourceKey: string;
  readonly sourceType: 'POST' | 'COMMENT';
  readonly text: string;
  readonly title?: string | null;
  readonly classification: 'DIRECT_PROBLEM' | 'SUPPORTING_SIGNAL' | 'CONTEXT_ONLY' | 'UNRELATED';
  readonly confidence: number;
  readonly problemFamily: string | null;
  readonly verified: boolean;
  readonly origin: 'COMMUNITY_AI' | 'DOMAIN_DIRECT_FALLBACK' | 'RECOVERY';
  readonly matchedDomainIds: readonly string[];
  readonly matchedFacetIds: readonly string[];
  readonly discoveryDomainId: string | null;
  readonly discoveryDomainName: string | null;
  readonly queryIntentId: string | null;
  readonly queryText: string | null;
  readonly collectionPhase: IdeaGenerationCollectionPhase;
  readonly sourceTier: IdeaGenerationCollectorTier;
};

export type IdeaGenerationBenchmarkCandidateSnapshot = {
  candidateId: string;
  selected: boolean;
  finalScore: number;
  qualityScore: number;
  opportunityRank: number;
  opportunityTitle: string;
  parsedOutput: ParsedIdeaAiOutput;
};

export type IdeaGenerationContext = {
  /**
   * Persisted IdeaGenerationRun identifier.
   */
  runId: string;

  /**
   * Registered-user or guest-session owner.
   */
  owner: IdeaOwner;

  /**
   * Requested and eventually authorized generation type.
   */
  generationType: IdeaGenerationType;

  /**
   * Software-domain identifier selected by the requester.
   */
  domainId: string;

  /**
   * Domain name loaded during request-validation or
   * data-source-selection stages.
   */
  domainName: string | null;

  /**
   * Ordered domains selected for the run.
   *
   * The first domain remains the primary database relation. The complete list
   * is used to require evidence and at least one problem-solution contribution
   * from every selected domain when the corpus can support it.
   */
  selectedDomains: SelectedGenerationDomain[];

  /**
   * Trace explaining why the primary domain was selected.
   * It is persisted for auditing and also preserves whether the primary domain
   * was explicitly selected so downstream intent gating cannot silently drop it.
   */
  domainResolution: IdeaGenerationDomainResolutionTrace | null;

  requestDescription: string | null;

  requestFingerprint: string | null;

  /** Explicit domain ids requested by the caller before PREPARING resolves the semantic primary domain. */
  requestedDomainIds: string[];

  /** Bounded AI/deterministic plan created inside the PREPARING pipeline stage when request text exists. */
  collectionPlan: RequestCollectionPlan | null;
  /** Canonical mode resolved once during PREPARING and never reinterpreted downstream. */
  requestMode: IdeaGenerationRequestMode;

  /** Immutable requester/discovery problem contract shared by search, verification, ranking, and Core. */
  canonicalProblemSpec: IdeaGenerationCanonicalProblemSpec | null;

  /** Single authoritative evidence state derived only from canonicalEvidenceLedger. */
  evidenceState: IdeaGenerationEvidenceState;


  /**
   * User-supplied keywords.
   *
   * Domain keywords may later be merged with these values by the
   * relevant collection or selection stage.
   */
  keywords: string[];

  /**
   * Raw data-source keys requested by the client.
   *
   * An empty array means the selection stage should resolve all
   * active and implemented sources.
   *
   * Keeping the requested keys separate from selectedDataSources
   * prevents the pipeline from losing the original request before
   * DATA_SOURCE_SELECTION executes.
   */
  requestedDataSourceKeys: string[];

  /**
   * Collection location and language metadata.
   */
  location: IdeaGenerationLocation;

  /**
   * Indicates whether compatible historical collection jobs must be ignored.
   */
  forceRefresh: boolean;

  /**
   * Entitlement decision calculated by the policy stage.
   *
   * It remains null before ENTITLEMENT_CHECK completes.
   */
  policy: IdeaGenerationPolicy | null;

  /**
   * Validated data sources selected by the selection stage.
   */
  selectedDataSources: SelectedIdeaDataSource[];

  /**
   * Reused or newly created collection-job information.
   */
  collection: IdeaGenerationCollectionResolution | null;

  /**
   * NLP analysis loaded or produced by the pipeline.
   */
  nlp: IdeaGenerationNlpContext | null;

  /**
   * Per-domain collection evidence preserved for prompt construction,
   * AI analysis, and benchmark validation.
   */
  domainEvidence: IdeaGenerationDomainEvidence[];

  /**
   * Complete collector-returned corpus (within each collector's network limits)
   * preserved before deterministic semantic/persistence pruning. Community AI
   * classifies every item; none becomes verified evidence until deterministic
   * request/workflow guards accept it after AI triage.
   */
  rawEvidenceCorpus: IdeaGenerationRawEvidenceItem[];


  /** Single deduplicated evidence source-of-truth used by ranking and recovery. */
  canonicalEvidenceLedger: IdeaGenerationCanonicalEvidenceItem[];

  /** Evidence-grounded LLM analysis over the cleaned NLP context. */
  communityAiAnalysis: CommunityAiAnalysis | null;

  /**
   * Deterministic ranking of evidence-backed product opportunities.
   */
  opportunityRanking: IdeaOpportunityRanking | null;

  /**
   * Opportunity attached to the final benchmark-winning idea candidate.
   *
   * This may differ from opportunityRanking.selected because the benchmark
   * intentionally compares candidates generated from several eligible ranked
   * opportunities before the comparative judge selects the strongest idea.
   */
  benchmarkWinnerOpportunity: RankedIdeaOpportunity | null;

  benchmarkCandidates: IdeaGenerationBenchmarkCandidateSnapshot[];

  /** Number of targeted evidence-recovery attempts used by this run. */
  evidenceRecoveryAttempts: number;

  /** Collection-job identifiers created by targeted evidence recovery. */
  evidenceRecoveryCollectionJobIds: string[];

  /**
   * Successful terminal outcome when no recurring evidence-backed problem was
   * found. This is not a technical pipeline failure and must not consume a
   * credit or persist an idea.
   */
  noResultOutcome: IdeaGenerationNoResultOutcome | null;

  /**
   * Prompt built for core idea generation.
   */
  prompt: IdeaGenerationPromptContext | null;

  /**
   * Parsed and validated core idea returned by the AI runtime.
   */
  coreIdea: CoreIdeaAiOutput | null;

  /**
   * Persisted Idea identifier.
   */
  ideaId: string | null;

  /**
   * Advanced outputs generated for premium-credit ideas.
   */
  advancedOutputs: AdvancedIdeaAiOutput[];

  /**
   * Persisted GeneratedOutput identifiers indexed by output key.
   *
   * A key-based map prevents premium checkpoints from depending on
   * array order and lets each stage verify the exact database record
   * created for its configured output.
   */
  generatedOutputIdsByKey: Partial<Record<IdeaAdvancedOutputKey, string>>;

  /**
   * Indicates whether the pipeline should stop at its next safe
   * cancellation checkpoint.
   */
  cancellationRequested: boolean;

  /**
   * Last stage whose complete context was durably checkpointed.
   *
   * Recovery uses this marker to avoid skipping completed stage rows whose
   * context changes were not yet persisted when the process stopped.
   */
  recoveryCheckpointStageKey: string | null;

  /**
   * Timestamp at which the context was initialized.
   */
  createdAt: Date;
};

/**
 * Input required to create an empty generation context.
 *
 * @author Malak
 */
export type CreateIdeaGenerationContextInput = {
  /**
   * Persisted generation-run identifier.
   */
  runId: string;

  /**
   * Registered-user or guest-session owner.
   */
  owner: IdeaOwner;

  /**
   * Generation type requested by the caller.
   */
  generationType: IdeaGenerationType;

  /**
   * Software-domain identifier.
   */
  domainId: string;

  /** Ordered cross-domain profile resolved before pipeline execution. */
  selectedDomains?: SelectedGenerationDomain[];

  /** Optional explainability trace for the primary domain resolution. */
  domainResolution?: IdeaGenerationDomainResolutionTrace | null;

  requestDescription?: string | null;

  requestFingerprint?: string | null;

  /** Explicit domain ids preserved until the PREPARING stage resolves the final domain profile. */
  requestedDomainIds?: string[];

  /** Optional in-pipeline pre-collection intent plan derived from request text. */
  collectionPlan?: RequestCollectionPlan | null;

  /**
   * Optional user-provided keywords.
   */
  keywords?: string[];

  /**
   * Optional data-source keys selected by the requester.
   */
  requestedDataSourceKeys?: string[];

  /**
   * Collection location and language metadata.
   */
  location: IdeaGenerationLocation;

  /**
   * Indicates whether compatible historical collection jobs must be ignored.
   */
  forceRefresh?: boolean;
};

/**
 * Creates a complete empty generation context.
 *
 * Centralizing context initialization guarantees that every
 * pipeline stage receives all expected properties, even before
 * those properties have been populated by previous stages.
 *
 * @param input Initial generation context information.
 * @returns Initialized idea-generation context.
 *
 * @author Malak
 */
export function createIdeaGenerationContext(
  input: CreateIdeaGenerationContextInput,
): IdeaGenerationContext {
  return {
    runId: input.runId,
    owner: input.owner,
    generationType: input.generationType,

    domainId: input.domainId,
    domainName: null,
    selectedDomains: input.selectedDomains ?? [],
    domainResolution: input.domainResolution ?? null,

    requestDescription: input.requestDescription ?? null,
    requestFingerprint: input.requestFingerprint ?? null,
    requestedDomainIds: input.requestedDomainIds ?? [],
    collectionPlan: input.collectionPlan ?? null,
    requestMode:
      input.requestDescription?.trim()
        ? (input.requestedDomainIds?.length ?? 0) > 0
          ? 'TEXT_AND_DOMAINS'
          : 'TEXT_ONLY'
        : (input.requestedDomainIds?.length ?? 0) > 0
          ? 'DOMAINS_ONLY'
          : 'NO_INPUT',
    canonicalProblemSpec: null,
    evidenceState: 'ZERO_VALIDATED_EVIDENCE',
    keywords: input.keywords ?? [],

    requestedDataSourceKeys: input.requestedDataSourceKeys ?? [],

    location: input.location,

    forceRefresh: input.forceRefresh ?? false,

    policy: null,
    selectedDataSources: [],

    collection: null,
    nlp: null,
    domainEvidence: [],
    rawEvidenceCorpus: [],
    canonicalEvidenceLedger: [],
    communityAiAnalysis: null,
    opportunityRanking: null,
    benchmarkWinnerOpportunity: null,
    benchmarkCandidates: [],
    evidenceRecoveryAttempts: 0,
    evidenceRecoveryCollectionJobIds: [],
    noResultOutcome: null,
    prompt: null,

    coreIdea: null,
    ideaId: null,

    advancedOutputs: [],
    generatedOutputIdsByKey: {},

    cancellationRequested: false,
    recoveryCheckpointStageKey: null,
    createdAt: new Date(),
  };
}