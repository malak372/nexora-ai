/**
 * @author Malak
 */

import { DEFAULT_STAGE_MAX_ATTEMPTS } from './idea-generation.constants';

/**
 * Stable keys used by the idea-generation pipeline.
 *
 * These keys are persisted in:
 * - IdeaGenerationRun.currentStageKey
 * - IdeaGenerationStage.stageKey
 *
 * Existing keys must not be renamed after production records
 * have been created.
 */
export const IDEA_GENERATION_STAGE_KEYS = {
  REQUEST_VALIDATION: 'request-validation',

  ENTITLEMENT_CHECK: 'entitlement-check',

  DATA_SOURCE_SELECTION: 'data-source-selection',

  COLLECTION_JOB_RESOLUTION: 'collection-job-resolution',

  DATA_COLLECTION: 'data-collection',

  NLP_ANALYSIS: 'nlp-analysis',

  PROMPT_BUILDING: 'prompt-building',

  CORE_IDEA_GENERATION: 'core-idea-generation',

  AI_OUTPUT_VALIDATION: 'ai-output-validation',

  DUPLICATE_CHECK: 'duplicate-check',

  IDEA_PERSISTENCE: 'idea-persistence',

  FULL_ABSTRACT_GENERATION: 'full-abstract-generation',

  TECHNOLOGY_STACK_GENERATION: 'technology-stack-generation',

  SYSTEM_ARCHITECTURE_GENERATION: 'system-architecture-generation',

  DATABASE_DESIGN_GENERATION: 'database-design-generation',

  MVP_FEATURES_GENERATION: 'mvp-features-generation',

  BUSINESS_MODEL_GENERATION: 'business-model-generation',

  VALUE_PROPOSITION_GENERATION: 'value-proposition-generation',

  REVENUE_MODEL_GENERATION: 'revenue-model-generation',

  LOCAL_REGULATIONS_GENERATION: 'local-regulations-generation',

  BUDGET_ESTIMATION_GENERATION: 'budget-estimation-generation',

  FEASIBILITY_ASSESSMENT_GENERATION: 'feasibility-assessment-generation',

  IMPLEMENTATION_TIMELINE_GENERATION: 'implementation-timeline-generation',

  MARKET_POTENTIAL_GENERATION: 'market-potential-generation',

  NLP_EXECUTIVE_SUMMARY_GENERATION: 'nlp-executive-summary-generation',

  COMMUNITY_FEEDBACK_SUMMARY_GENERATION:
    'community-feedback-summary-generation',

  FINALIZATION: 'finalization',
} as const;

/**
 * Union of all supported idea-generation pipeline-stage keys.
 */
export type IdeaGenerationStageKey =
  (typeof IDEA_GENERATION_STAGE_KEYS)[keyof typeof IDEA_GENERATION_STAGE_KEYS];

/**
 * Static configuration used when initializing one generation
 * stage.
 */
export type IdeaGenerationStageDefinition = {
  /**
   * Stable stage identifier persisted in the database.
   */
  readonly key: IdeaGenerationStageKey;

  /**
   * Human-readable stage title displayed to the user.
   */
  readonly displayName: string;

  /**
   * One-based order of the stage inside the pipeline.
   */
  readonly sequence: number;

  /**
   * Progress percentage visible when the stage begins.
   */
  readonly progressStart: number;

  /**
   * Progress percentage visible when the stage completes.
   */
  readonly progressEnd: number;

  /**
   * Maximum number of execution attempts.
   */
  readonly maxAttempts: number;

  /**
   * Indicates whether the stage belongs only to premium
   * generation.
   */
  readonly requiredForPremium: boolean;
};

/**
 * Core stages executed for every generation type.
 *
 * Supported generation types:
 * - Guest free generation.
 * - Registered-user free generation.
 * - Premium-credit generation.
 */
export const CORE_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [
    {
      key: IDEA_GENERATION_STAGE_KEYS.REQUEST_VALIDATION,

      displayName: 'Request validation',

      sequence: 1,

      progressStart: 0,

      progressEnd: 5,

      maxAttempts: 1,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.ENTITLEMENT_CHECK,

      displayName: 'Entitlement check',

      sequence: 2,

      progressStart: 5,

      progressEnd: 10,

      maxAttempts: 1,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.DATA_SOURCE_SELECTION,

      displayName: 'Data-source selection',

      sequence: 3,

      progressStart: 10,

      progressEnd: 15,

      maxAttempts: 1,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION,

      displayName: 'Collection-job resolution',

      sequence: 4,

      progressStart: 15,

      progressEnd: 20,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.DATA_COLLECTION,

      displayName: 'Data collection',

      sequence: 5,

      progressStart: 20,

      progressEnd: 35,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.NLP_ANALYSIS,

      displayName: 'NLP analysis',

      sequence: 6,

      progressStart: 35,

      progressEnd: 48,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.PROMPT_BUILDING,

      displayName: 'Prompt building',

      sequence: 7,

      progressStart: 48,

      progressEnd: 53,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION,

      displayName: 'Core idea generation',

      sequence: 8,

      progressStart: 53,

      progressEnd: 65,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.AI_OUTPUT_VALIDATION,

      displayName: 'AI output validation',

      sequence: 9,

      progressStart: 65,

      progressEnd: 70,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.DUPLICATE_CHECK,

      displayName: 'Duplicate detection',

      sequence: 10,

      progressStart: 70,

      progressEnd: 75,

      maxAttempts: 1,

      requiredForPremium: false,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE,

      displayName: 'Idea persistence',

      sequence: 27,

      progressStart: 98,

      progressEnd: 99,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: false,
    },
  ] as const;

/**
 * Premium-output pipeline stages.
 *
 * The AI provider currently returns all premium outputs in one
 * structured response. These stages therefore act as progressive
 * validation checkpoints before entitlement consumption and persistence.
 *
 * The stage list must stay aligned with:
 * - IDEA_ADVANCED_OUTPUT_DEFINITIONS.
 * - REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.
 * - PremiumOutputGenerationStage registrations in IdeasModule.
 */
export const PREMIUM_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [
    {
      key: IDEA_GENERATION_STAGE_KEYS.FULL_ABSTRACT_GENERATION,

      displayName: 'Full abstract',

      sequence: 11,

      progressStart: 75,

      progressEnd: 77,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.TECHNOLOGY_STACK_GENERATION,

      displayName: 'Technology stack',

      sequence: 12,

      progressStart: 77,

      progressEnd: 79,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.SYSTEM_ARCHITECTURE_GENERATION,

      displayName: 'System architecture',

      sequence: 13,

      progressStart: 79,

      progressEnd: 81,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.DATABASE_DESIGN_GENERATION,

      displayName: 'Database design',

      sequence: 14,

      progressStart: 81,

      progressEnd: 83,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.MVP_FEATURES_GENERATION,

      displayName: 'MVP features',

      sequence: 15,

      progressStart: 83,

      progressEnd: 85,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.BUSINESS_MODEL_GENERATION,

      displayName: 'Business model',

      sequence: 16,

      progressStart: 85,

      progressEnd: 87,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.VALUE_PROPOSITION_GENERATION,

      displayName: 'Value proposition',

      sequence: 17,

      progressStart: 87,

      progressEnd: 89,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.REVENUE_MODEL_GENERATION,

      displayName: 'Revenue model',

      sequence: 18,

      progressStart: 89,

      progressEnd: 90,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.LOCAL_REGULATIONS_GENERATION,

      displayName: 'Local regulations',

      sequence: 19,

      progressStart: 90,

      progressEnd: 91,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.BUDGET_ESTIMATION_GENERATION,

      displayName: 'Budget estimation',

      sequence: 20,

      progressStart: 91,

      progressEnd: 92,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.FEASIBILITY_ASSESSMENT_GENERATION,

      displayName: 'Feasibility assessment',

      sequence: 21,

      progressStart: 92,

      progressEnd: 93,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.IMPLEMENTATION_TIMELINE_GENERATION,

      displayName: 'Implementation timeline',

      sequence: 22,

      progressStart: 93,

      progressEnd: 94,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.MARKET_POTENTIAL_GENERATION,

      displayName: 'Market potential',

      sequence: 23,

      progressStart: 94,

      progressEnd: 95,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.NLP_EXECUTIVE_SUMMARY_GENERATION,

      displayName: 'NLP executive summary',

      sequence: 24,

      progressStart: 95,

      progressEnd: 97,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },

    {
      key: IDEA_GENERATION_STAGE_KEYS.COMMUNITY_FEEDBACK_SUMMARY_GENERATION,

      displayName: 'Community feedback summary',

      sequence: 25,

      progressStart: 97,

      progressEnd: 98,

      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

      requiredForPremium: true,
    },
  ] as const;

/**
 * Final stage executed after all required stages have completed.
 */
export const IDEA_GENERATION_FINALIZATION_STAGE: IdeaGenerationStageDefinition =
  {
    key: IDEA_GENERATION_STAGE_KEYS.FINALIZATION,

    displayName: 'Generation finalization',

    sequence: 28,

    progressStart: 99,

    progressEnd: 100,

    maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,

    requiredForPremium: false,
  };

/**
 * Complete stage list used by premium-credit generation.
 */
export const ALL_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [
    ...CORE_IDEA_GENERATION_STAGES,

    ...PREMIUM_IDEA_GENERATION_STAGES,

    IDEA_GENERATION_FINALIZATION_STAGE,
  ] as const;

/**
 * Complete stage list used by guest and registered-user free
 * generation.
 *
 * Premium-only output stages are excluded. Core-stage and finalization
 * definitions are intentionally reused without modification so every
 * stage implementation and pipeline policy references the same central
 * configuration.
 *
 * Sequence gaps are valid because execution order is determined by the
 * configured sequence values. Keeping the original definitions prevents
 * runtime configuration conflicts between stage implementations and the
 * resolved free-generation pipeline.
 */
export const FREE_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [...CORE_IDEA_GENERATION_STAGES, IDEA_GENERATION_FINALIZATION_STAGE] as const;

/**
 * Returns the correct pipeline-stage definitions for the
 * resolved generation policy.
 *
 * @param includePremiumStages Whether premium checkpoints are
 * required.
 * @returns Ordered stage definitions.
 */
export function getIdeaGenerationStageDefinitions(
  includePremiumStages: boolean,
): readonly IdeaGenerationStageDefinition[] {
  return includePremiumStages
    ? ALL_IDEA_GENERATION_STAGES
    : FREE_IDEA_GENERATION_STAGES;
}

/**
 * Finds one registered stage definition by its stable key.
 *
 * @param stageKey Stable pipeline-stage key.
 * @returns Matching definition or undefined.
 */
export function findIdeaGenerationStageDefinition(
  stageKey: IdeaGenerationStageKey,
): IdeaGenerationStageDefinition | undefined {
  return ALL_IDEA_GENERATION_STAGES.find((stage) => stage.key === stageKey);
}

/**
 * Returns the ending progress percentage associated with one
 * generation stage.
 *
 * @param stageKey Stable pipeline-stage key.
 * @returns Stage completion percentage or zero when missing.
 */
export function getStageCompletionProgress(
  stageKey: IdeaGenerationStageKey,
): number {
  return findIdeaGenerationStageDefinition(stageKey)?.progressEnd ?? 0;
}

/**
 * Determines whether a stage belongs exclusively to premium
 * generation.
 *
 * @param stageKey Stable pipeline-stage key.
 * @returns Whether the stage is premium-only.
 */
export function isPremiumIdeaGenerationStage(
  stageKey: IdeaGenerationStageKey,
): boolean {
  return PREMIUM_IDEA_GENERATION_STAGES.some((stage) => stage.key === stageKey);
}
