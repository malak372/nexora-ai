import type { Provider } from '@nestjs/common';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
  type IdeaGenerationStageKey,
} from '../constants/idea-generation-stages.constants';

import {
  PremiumOutputGenerationStage,
  type PremiumOutputGenerationStageOptions,
} from '../pipeline/stages/premium-output-generation.stage';

import type { IdeaAdvancedOutputKey } from '../types/idea-ai-output.type';

/**
 * Injection tokens for configured premium-output verification stages.
 *
 * @author Malak
 */
export const PREMIUM_OUTPUT_STAGE_TOKENS = {
  FULL_ABSTRACT: Symbol('PREMIUM_STAGE_FULL_ABSTRACT'),
  TECHNOLOGY_STACK: Symbol('PREMIUM_STAGE_TECHNOLOGY_STACK'),
  SYSTEM_ARCHITECTURE: Symbol('PREMIUM_STAGE_SYSTEM_ARCHITECTURE'),
  DATABASE_DESIGN: Symbol('PREMIUM_STAGE_DATABASE_DESIGN'),
  MVP_FEATURES: Symbol('PREMIUM_STAGE_MVP_FEATURES'),
  BUSINESS_MODEL: Symbol('PREMIUM_STAGE_BUSINESS_MODEL'),
  VALUE_PROPOSITION: Symbol('PREMIUM_STAGE_VALUE_PROPOSITION'),
  REVENUE_MODEL: Symbol('PREMIUM_STAGE_REVENUE_MODEL'),
  LOCAL_REGULATIONS: Symbol('PREMIUM_STAGE_LOCAL_REGULATIONS'),
  BUDGET_ESTIMATION: Symbol('PREMIUM_STAGE_BUDGET_ESTIMATION'),
  FEASIBILITY_ASSESSMENT: Symbol('PREMIUM_STAGE_FEASIBILITY_ASSESSMENT'),
  IMPLEMENTATION_TIMELINE: Symbol('PREMIUM_STAGE_IMPLEMENTATION_TIMELINE'),
  MARKET_POTENTIAL: Symbol('PREMIUM_STAGE_MARKET_POTENTIAL'),
  NLP_EXECUTIVE_SUMMARY: Symbol('PREMIUM_STAGE_NLP_EXECUTIVE_SUMMARY'),
  COMMUNITY_FEEDBACK_SUMMARY: Symbol(
    'PREMIUM_STAGE_COMMUNITY_FEEDBACK_SUMMARY',
  ),
} as const;

/**
 * Configuration required to register one premium-output stage.
 *
 * @author Malak
 */
export type PremiumOutputStageRegistration = {
  /**
   * NestJS dependency-injection token for the stage.
   */
  readonly token: symbol;

  /**
   * Centralized generation-stage registry key.
   */
  readonly stageKey: IdeaGenerationStageKey;

  /**
   * Advanced output verified by this stage.
   */
  readonly outputKey: IdeaAdvancedOutputKey;

  /**
   * Determines whether this output must exist.
   *
   * When omitted, the premium-output stage uses its default behavior.
   */
  readonly required?: boolean;
};

/**
 * Ordered premium-output stage registrations.
 *
 * The order must remain aligned with the centralized generation-stage
 * registry and GeneratedOutput.sequence values.
 *
 * @author Malak
 */
export const PREMIUM_OUTPUT_STAGE_REGISTRATIONS = [
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.FULL_ABSTRACT,
    stageKey: IDEA_GENERATION_STAGE_KEYS.FULL_ABSTRACT_GENERATION,
    outputKey: 'full-abstract',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.TECHNOLOGY_STACK,
    stageKey: IDEA_GENERATION_STAGE_KEYS.TECHNOLOGY_STACK_GENERATION,
    outputKey: 'technology-stack',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.SYSTEM_ARCHITECTURE,
    stageKey: IDEA_GENERATION_STAGE_KEYS.SYSTEM_ARCHITECTURE_GENERATION,
    outputKey: 'system-architecture',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.DATABASE_DESIGN,
    stageKey: IDEA_GENERATION_STAGE_KEYS.DATABASE_DESIGN_GENERATION,
    outputKey: 'database-design',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.MVP_FEATURES,
    stageKey: IDEA_GENERATION_STAGE_KEYS.MVP_FEATURES_GENERATION,
    outputKey: 'mvp-features',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.BUSINESS_MODEL,
    stageKey: IDEA_GENERATION_STAGE_KEYS.BUSINESS_MODEL_GENERATION,
    outputKey: 'business-model',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.VALUE_PROPOSITION,
    stageKey: IDEA_GENERATION_STAGE_KEYS.VALUE_PROPOSITION_GENERATION,
    outputKey: 'value-proposition',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.REVENUE_MODEL,
    stageKey: IDEA_GENERATION_STAGE_KEYS.REVENUE_MODEL_GENERATION,
    outputKey: 'revenue-model',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.LOCAL_REGULATIONS,
    stageKey: IDEA_GENERATION_STAGE_KEYS.LOCAL_REGULATIONS_GENERATION,
    outputKey: 'local-regulations',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.BUDGET_ESTIMATION,
    stageKey: IDEA_GENERATION_STAGE_KEYS.BUDGET_ESTIMATION_GENERATION,
    outputKey: 'budget-estimation',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.FEASIBILITY_ASSESSMENT,
    stageKey: IDEA_GENERATION_STAGE_KEYS.FEASIBILITY_ASSESSMENT_GENERATION,
    outputKey: 'feasibility-assessment',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.IMPLEMENTATION_TIMELINE,
    stageKey: IDEA_GENERATION_STAGE_KEYS.IMPLEMENTATION_TIMELINE_GENERATION,
    outputKey: 'implementation-timeline',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.MARKET_POTENTIAL,
    stageKey: IDEA_GENERATION_STAGE_KEYS.MARKET_POTENTIAL_GENERATION,
    outputKey: 'market-potential',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.NLP_EXECUTIVE_SUMMARY,
    stageKey: IDEA_GENERATION_STAGE_KEYS.NLP_EXECUTIVE_SUMMARY_GENERATION,
    outputKey: 'nlp-executive-summary',
  },
  {
    token: PREMIUM_OUTPUT_STAGE_TOKENS.COMMUNITY_FEEDBACK_SUMMARY,
    stageKey: IDEA_GENERATION_STAGE_KEYS.COMMUNITY_FEEDBACK_SUMMARY_GENERATION,
    outputKey: 'community-feedback-summary',
  },
] as const satisfies readonly PremiumOutputStageRegistration[];

/**
 * Resolves a required generation-stage definition.
 *
 * Throws during application startup when a premium registration references
 * a stage that does not exist in the centralized registry.
 */
function getRequiredStageDefinition(
  stageKey: IdeaGenerationStageKey,
): IdeaGenerationStageDefinition {
  const definition = findIdeaGenerationStageDefinition(stageKey);

  if (!definition) {
    throw new Error(
      `Missing idea-generation stage definition for "${stageKey}".`,
    );
  }

  return definition;
}

/**
 * Builds immutable options for one premium-output stage.
 */
function createPremiumOutputStageOptions(
  registration: PremiumOutputStageRegistration,
): PremiumOutputGenerationStageOptions {
  return {
    definition: getRequiredStageDefinition(registration.stageKey),
    outputKey: registration.outputKey,

    ...(registration.required !== undefined
      ? {
          required: registration.required,
        }
      : {}),
  };
}

/**
 * Creates one NestJS provider for a configured premium-output stage.
 */
function createPremiumOutputStageProvider(
  registration: PremiumOutputStageRegistration,
): Provider {
  return {
    provide: registration.token,

    useFactory: (): PremiumOutputGenerationStage =>
      new PremiumOutputGenerationStage(
        createPremiumOutputStageOptions(registration),
      ),
  };
}

/**
 * NestJS providers for every configured premium-output checkpoint.
 *
 * @author Malak
 */
export const PREMIUM_OUTPUT_STAGE_PROVIDERS: Provider[] =
  PREMIUM_OUTPUT_STAGE_REGISTRATIONS.map(createPremiumOutputStageProvider);
