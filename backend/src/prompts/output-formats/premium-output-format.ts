/**
 * Provider-neutral JSON schema describing the expected response
 * for premium credit-based idea generation.
 *
 * The AI generates project-planning content and readable summaries
 * derived from the trusted NLP data included in the prompt.
 *
 * Trusted source data such as:
 * - recurring problems
 * - extracted keywords
 * - sample comments
 * - analyzed comment counts
 * - NLP confidence
 *
 * must not be regenerated or copied into this output. These values
 * are loaded directly from NlpAnalysis and appended later by the
 * application response builder.
 *
 * This schema must remain synchronized with:
 * - PREMIUM_OUTPUT_FORMAT
 * - PremiumIdeaSchema
 *
 * @author Malak
 */
export const PREMIUM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /**
     * Generated software-project title.
     */
    title: {
      type: 'string',
      minLength: 3,
      maxLength: 200,
    },

    /**
     * Description of the real problem addressed by the project.
     */
    problemStatement: {
      type: 'string',
      minLength: 20,
      maxLength: 1_500,
    },

    /**
     * Main project goals and expected outcomes.
     */
    objectives: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'string',
        minLength: 3,
        maxLength: 300,
      },
    },

    /**
     * Primary users or organizations expected to use the project.
     */
    targetUsers: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'string',
        minLength: 2,
        maxLength: 200,
      },
    },

    /**
     * Complete project abstract.
     */
    fullAbstract: {
      type: 'string',
      minLength: 50,
      maxLength: 5_000,
    },

    /**
     * Recommended technologies required to implement the project.
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
     * Preliminary assessment of the project's market opportunity.
     */
    marketPotential: {
      type: 'string',
      minLength: 20,
      maxLength: 2_500,
    },

    /**
     * High-level local regulatory considerations.
     *
     * This field must not be presented as verified legal advice.
     */
    localRegulations: {
      type: 'string',
      minLength: 20,
      maxLength: 2_000,
    },

    /**
     * Explanation of the unique value offered to target users.
     */
    valueProposition: {
      type: 'string',
      minLength: 20,
      maxLength: 1_800,
    },

    /**
     * AI-generated readable interpretation of the trusted NLP data.
     *
     * This is not the raw NlpAnalysis database record.
     */
    nlpExecutiveSummary: {
      type: 'string',
      minLength: 20,
      maxLength: 2_500,
    },

    /**
     * AI-generated readable summary of the supplied community
     * posts, comments, recurring problems, and community needs.
     */
    communityFeedbackSummary: {
      type: 'string',
      minLength: 20,
      maxLength: 1_500,
    },
  },
  required: [
    'title',
    'problemStatement',
    'objectives',
    'targetUsers',
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
 * Human-readable JSON example inserted into the prompt.
 *
 * The AI must follow these exact field names and value types.
 * Trusted NLP and collection metadata are appended later by
 * the application and are not included in this format.
 */
export const PREMIUM_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',
    problemStatement: 'string',
    objectives: ['string'],
    targetUsers: ['string'],
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