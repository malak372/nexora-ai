/**
 * Provider-neutral JSON schema describing the expected response
 * for direct idea-unlock requests.
 *
 * Direct unlock expands an existing NORMAL_FREE idea and returns
 * advanced content only.
 *
 * Basic fields such as:
 * - title
 * - problem statement
 * - objectives
 * - target users
 *
 * already exist on the original idea and must not be regenerated.
 *
 * Trusted NLP data is appended later from NlpAnalysis by IdeasService
 * or a dedicated response builder.
 *
 * This schema must remain synchronized with:
 * - UNLOCK_OUTPUT_FORMAT
 * - UnlockIdeaSchema
 *
 * @author Malak
 */
export const UNLOCK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /**
     * Complete abstract expanding the existing free-tier idea.
     */
    fullAbstract: {
      type: 'string',
      minLength: 50,
      maxLength: 5_000,
    },

    /**
     * Recommended technologies required to implement the idea.
     */
    technologyStack: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
    },

    /**
     * High-level system architecture recommendation.
     */
    systemArchitecture: {
      type: 'string',
      minLength: 20,
      maxLength: 4_000,
    },

    /**
     * Preliminary database-design recommendation.
     */
    databaseDesign: {
      type: 'string',
      minLength: 20,
      maxLength: 4_000,
    },

    /**
     * Minimum viable product features.
     */
    mvpFeatures: {
      type: 'array',
      minItems: 3,
      maxItems: 15,
      items: {
        type: 'string',
        minLength: 3,
        maxLength: 300,
      },
    },

    /**
     * Preliminary business-model recommendation.
     */
    businessModel: {
      type: 'string',
      minLength: 20,
      maxLength: 2_500,
    },

    /**
     * Suggested revenue streams and monetization strategy.
     */
    revenueModel: {
      type: 'string',
      minLength: 20,
      maxLength: 2_000,
    },

    /**
     * Preliminary project budget range.
     */
    budgetEstimation: {
      type: 'string',
      minLength: 20,
      maxLength: 2_000,
    },

    /**
     * Suggested project implementation timeline.
     */
    implementationTimeline: {
      type: 'string',
      minLength: 20,
      maxLength: 2_000,
    },

    /**
     * Technical and operational feasibility assessment.
     */
    feasibilityAssessment: {
      type: 'string',
      minLength: 20,
      maxLength: 2_500,
    },

    /**
     * Preliminary assessment of market opportunity.
     */
    marketPotential: {
      type: 'string',
      minLength: 20,
      maxLength: 2_500,
    },

    /**
     * High-level local regulatory considerations.
     */
    localRegulations: {
      type: 'string',
      minLength: 20,
      maxLength: 2_000,
    },

    /**
     * Explanation of the value offered to target users.
     */
    valueProposition: {
      type: 'string',
      minLength: 20,
      maxLength: 1_800,
    },

    /**
     * AI-generated readable interpretation of trusted NLP data.
     */
    nlpExecutiveSummary: {
      type: 'string',
      minLength: 20,
      maxLength: 2_500,
    },

    /**
     * AI-generated readable summary of community feedback.
     */
    communityFeedbackSummary: {
      type: 'string',
      minLength: 20,
      maxLength: 1_500,
    },
  },
  required: [
    'fullAbstract',
    'technologyStack',
    'systemArchitecture',
    'databaseDesign',
    'mvpFeatures',
    'businessModel',
    'revenueModel',
    'budgetEstimation',
    'implementationTimeline',
    'feasibilityAssessment',
    'marketPotential',
    'localRegulations',
    'valueProposition',
    'nlpExecutiveSummary',
    'communityFeedbackSummary',
  ],
} as const;

/**
 * Human-readable JSON example inserted into the unlock prompt.
 *
 * The AI must follow these exact field names and value types.
 * Trusted NLP and collection metadata are appended later by
 * the application.
 */
export const UNLOCK_OUTPUT_FORMAT = JSON.stringify(
  {
    fullAbstract: 'string',
    technologyStack: ['string'],
    systemArchitecture: 'string',
    databaseDesign: 'string',
    mvpFeatures: ['string'],
    businessModel: 'string',
    revenueModel: 'string',
    budgetEstimation: 'string',
    implementationTimeline: 'string',
    feasibilityAssessment: 'string',
    marketPotential: 'string',
    localRegulations: 'string',
    valueProposition: 'string',
    nlpExecutiveSummary: 'string',
    communityFeedbackSummary: 'string',
  },
  null,
  2,
);
