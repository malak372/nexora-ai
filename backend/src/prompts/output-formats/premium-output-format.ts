import {
  ADVANCED_IDEA_OUTPUT_FORMAT,
  ADVANCED_IDEA_OUTPUT_PROPERTIES,
  ADVANCED_IDEA_REQUIRED_FIELDS,
  BASE_IDEA_OUTPUT_FORMAT,
  FULL_ABSTRACT_OUTPUT_PROPERTY,
  IDEA_OBJECTIVES_OUTPUT_PROPERTY,
  IDEA_TARGET_USERS_OUTPUT_PROPERTY,
  IDEA_TITLE_OUTPUT_PROPERTY,
  PREMIUM_PROBLEM_STATEMENT_OUTPUT_PROPERTY,
} from './idea-shared-output-fields';

/**
 * Provider-neutral JSON Schema describing the expected response for
 * premium credit-based idea generation.
 *
 * The AI generates project-planning content and readable summaries
 * derived from trusted NLP context supplied in the prompt.
 *
 * Trusted source values such as:
 * - Recurring problems.
 * - Extracted needs.
 * - Extracted keywords.
 * - Sample comments.
 * - Analyzed-comment counts.
 * - NLP confidence values.
 *
 * must not be regenerated as raw output fields. These values are loaded
 * directly from NlpAnalysis and appended later by the application
 * response builder.
 *
 * This schema must remain synchronized with:
 * - PREMIUM_OUTPUT_FORMAT
 * - PremiumIdeaSchema
 * - The premium-generation prompt template
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
    title: IDEA_TITLE_OUTPUT_PROPERTY,

    /**
     * Description of the real problem addressed by the project.
     */
    problemStatement: PREMIUM_PROBLEM_STATEMENT_OUTPUT_PROPERTY,

    /**
     * Main project goals and expected outcomes.
     */
    objectives: IDEA_OBJECTIVES_OUTPUT_PROPERTY,

    /**
     * Primary users or organizations expected to use the project.
     */
    targetUsers: IDEA_TARGET_USERS_OUTPUT_PROPERTY,

    /**
     * Complete project abstract.
     */
    fullAbstract: FULL_ABSTRACT_OUTPUT_PROPERTY,

    /**
     * Shared advanced project-planning fields.
     */
    ...ADVANCED_IDEA_OUTPUT_PROPERTIES,
  },

  required: [
    'title',
    'problemStatement',
    'objectives',
    'targetUsers',
    'fullAbstract',
    ...ADVANCED_IDEA_REQUIRED_FIELDS,
  ],
} as const;

/**
 * Human-readable JSON example inserted into the premium-generation
 * prompt.
 *
 * The AI must follow these exact field names and value types.
 *
 * Trusted NLP and collection metadata are appended later by the
 * application and are intentionally excluded from this format.
 */
export const PREMIUM_OUTPUT_FORMAT = JSON.stringify(
  {
    ...BASE_IDEA_OUTPUT_FORMAT,
    fullAbstract: 'string',
    ...ADVANCED_IDEA_OUTPUT_FORMAT,
  },
  null,
  2,
);
