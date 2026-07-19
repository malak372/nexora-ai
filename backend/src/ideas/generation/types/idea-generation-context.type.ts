import {
  IdeaGenerationType,
  LanguageCode,
  Prisma,
} from '@prisma/client';

import type { IdeaOwner } from '../../shared/types/idea-owner.type';

import type {
  AdvancedIdeaAiOutput,
  CoreIdeaAiOutput,
} from './idea-ai-output.type';

import type { IdeaGenerationPolicy } from './idea-generation-policy.type';

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
   * Number of collected post records.
   */
  totalPosts: number;

  /**
   * Number of collected comment records.
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
   * Identifiers of generated-output records already persisted.
   */
  generatedOutputIds: string[];

  /**
   * Indicates whether the pipeline should stop at its next safe
   * cancellation checkpoint.
   */
  cancellationRequested: boolean;

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

    keywords: input.keywords ?? [],

    requestedDataSourceKeys:
      input.requestedDataSourceKeys ?? [],

    location: input.location,

    policy: null,
    selectedDataSources: [],

    collection: null,
    nlp: null,
    prompt: null,

    coreIdea: null,
    ideaId: null,

    advancedOutputs: [],
    generatedOutputIds: [],

    cancellationRequested: false,
    createdAt: new Date(),
  };
}