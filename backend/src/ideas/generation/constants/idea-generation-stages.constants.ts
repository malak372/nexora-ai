import { DEFAULT_STAGE_MAX_ATTEMPTS } from './idea-generation.constants';

/**
 * Stable keys used by the idea-generation pipeline.
 *
 * These keys are persisted in:
 * - IdeaGenerationRun.currentStageKey
 * - IdeaGenerationStage.stageKey
 *
 * Existing keys should not be renamed after production data
 * has been created.
 *
 * @author malak
 */
export const IDEA_GENERATION_STAGE_KEYS = {
  REQUEST_VALIDATION: 'request-validation',
  ENTITLEMENT_CHECK: 'entitlement-check',
  DATA_SOURCE_SELECTION: 'data-source-selection',
  COLLECTION_JOB_RESOLUTION:
    'collection-job-resolution',
  DATA_COLLECTION: 'data-collection',
  NLP_ANALYSIS: 'nlp-analysis',
  PROMPT_BUILDING: 'prompt-building',
  CORE_IDEA_GENERATION: 'core-idea-generation',
  AI_OUTPUT_VALIDATION: 'ai-output-validation',
  DUPLICATE_CHECK: 'duplicate-check',
  IDEA_PERSISTENCE: 'idea-persistence',

  FULL_ABSTRACT_GENERATION:
    'full-abstract-generation',
  TECHNOLOGY_STACK_GENERATION:
    'technology-stack-generation',
  SYSTEM_ARCHITECTURE_GENERATION:
    'system-architecture-generation',
  DATABASE_DESIGN_GENERATION:
    'database-design-generation',
  BUSINESS_MODEL_GENERATION:
    'business-model-generation',
  BUDGET_GENERATION: 'budget-generation',
  TIMELINE_GENERATION: 'timeline-generation',
  FEASIBILITY_GENERATION:
    'feasibility-generation',
  MARKET_POTENTIAL_GENERATION:
    'market-potential-generation',
  REVENUE_MODEL_GENERATION:
    'revenue-model-generation',
  LOCAL_REGULATIONS_GENERATION:
    'local-regulations-generation',

  FINALIZATION: 'finalization',
} as const;

/**
 * Union of all supported generation-stage keys.
 */
export type IdeaGenerationStageKey =
  (typeof IDEA_GENERATION_STAGE_KEYS)[keyof typeof IDEA_GENERATION_STAGE_KEYS];

/**
 * Stage configuration used when initializing a generation run.
 */
export type IdeaGenerationStageDefinition = {
  key: IdeaGenerationStageKey;
  displayName: string;
  sequence: number;
  progressStart: number;
  progressEnd: number;
  maxAttempts: number;
  requiredForPremium: boolean;
};

/**
 * Core stages executed for all generation types.
 *
 * Guest and registered free generations stop after the core
 * idea is persisted and finalized.
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
      key:
        IDEA_GENERATION_STAGE_KEYS
          .COLLECTION_JOB_RESOLUTION,
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
      key:
        IDEA_GENERATION_STAGE_KEYS
          .CORE_IDEA_GENERATION,
      displayName: 'Core idea generation',
      sequence: 8,
      progressStart: 53,
      progressEnd: 65,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: false,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .AI_OUTPUT_VALIDATION,
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
      sequence: 11,
      progressStart: 75,
      progressEnd: 80,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: false,
    },
  ] as const;

/**
 * Advanced stages executed only for premium-credit generation.
 *
 * Each output is generated separately to support:
 * - Progressive frontend rendering.
 * - Isolated retries.
 * - Partial failure recovery.
 * - Output-specific persistence.
 */
export const PREMIUM_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .FULL_ABSTRACT_GENERATION,
      displayName: 'Full abstract generation',
      sequence: 12,
      progressStart: 80,
      progressEnd: 82,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .TECHNOLOGY_STACK_GENERATION,
      displayName: 'Technology stack generation',
      sequence: 13,
      progressStart: 82,
      progressEnd: 84,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .SYSTEM_ARCHITECTURE_GENERATION,
      displayName: 'System architecture generation',
      sequence: 14,
      progressStart: 84,
      progressEnd: 86,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .DATABASE_DESIGN_GENERATION,
      displayName: 'Database design generation',
      sequence: 15,
      progressStart: 86,
      progressEnd: 88,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .BUSINESS_MODEL_GENERATION,
      displayName: 'Business model generation',
      sequence: 16,
      progressStart: 88,
      progressEnd: 90,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key: IDEA_GENERATION_STAGE_KEYS.BUDGET_GENERATION,
      displayName: 'Budget generation',
      sequence: 17,
      progressStart: 90,
      progressEnd: 92,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .TIMELINE_GENERATION,
      displayName: 'Timeline generation',
      sequence: 18,
      progressStart: 92,
      progressEnd: 94,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .FEASIBILITY_GENERATION,
      displayName: 'Feasibility generation',
      sequence: 19,
      progressStart: 94,
      progressEnd: 95,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .MARKET_POTENTIAL_GENERATION,
      displayName: 'Market potential generation',
      sequence: 20,
      progressStart: 95,
      progressEnd: 96,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .REVENUE_MODEL_GENERATION,
      displayName: 'Revenue model generation',
      sequence: 21,
      progressStart: 96,
      progressEnd: 97,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
    {
      key:
        IDEA_GENERATION_STAGE_KEYS
          .LOCAL_REGULATIONS_GENERATION,
      displayName: 'Local regulations generation',
      sequence: 22,
      progressStart: 97,
      progressEnd: 99,
      maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
      requiredForPremium: true,
    },
  ] as const;

/**
 * Final stage executed for every generation run.
 */
export const IDEA_GENERATION_FINALIZATION_STAGE: IdeaGenerationStageDefinition =
  {
    key: IDEA_GENERATION_STAGE_KEYS.FINALIZATION,
    displayName: 'Generation finalization',
    sequence: 23,
    progressStart: 99,
    progressEnd: 100,
    maxAttempts: DEFAULT_STAGE_MAX_ATTEMPTS,
    requiredForPremium: false,
  };

/**
 * Complete stage list used for premium generation.
 */
export const ALL_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [
    ...CORE_IDEA_GENERATION_STAGES,
    ...PREMIUM_IDEA_GENERATION_STAGES,
    IDEA_GENERATION_FINALIZATION_STAGE,
  ];

/**
 * Complete stage list used for guest and normal-free generation.
 *
 * The finalization sequence is recalculated so the stored stage
 * ordering remains continuous for non-premium runs.
 */
export const FREE_IDEA_GENERATION_STAGES: readonly IdeaGenerationStageDefinition[] =
  [
    ...CORE_IDEA_GENERATION_STAGES,

    {
      ...IDEA_GENERATION_FINALIZATION_STAGE,
      sequence:
        CORE_IDEA_GENERATION_STAGES.length + 1,
      progressStart: 80,
      progressEnd: 100,
    },
  ];

/**
 * Returns the correct pipeline-stage definitions according to
 * whether premium outputs are required.
 */
export function getIdeaGenerationStageDefinitions(
  includePremiumStages: boolean,
): readonly IdeaGenerationStageDefinition[] {
  return includePremiumStages
    ? ALL_IDEA_GENERATION_STAGES
    : FREE_IDEA_GENERATION_STAGES;
}

/**
 * Finds one stage definition by its stable key.
 */
export function findIdeaGenerationStageDefinition(
  stageKey: IdeaGenerationStageKey,
): IdeaGenerationStageDefinition | undefined {
  return ALL_IDEA_GENERATION_STAGES.find(
    (stage) => stage.key === stageKey,
  );
}

/**
 * Returns the ending progress percentage associated with
 * one generation stage.
 */
export function getStageCompletionProgress(
  stageKey: IdeaGenerationStageKey,
): number {
  return (
    findIdeaGenerationStageDefinition(stageKey)
      ?.progressEnd ?? 0
  );
}