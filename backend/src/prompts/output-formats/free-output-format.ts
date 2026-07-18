import {
  BASE_IDEA_OUTPUT_FORMAT,
  FREE_PROBLEM_STATEMENT_OUTPUT_PROPERTY,
  IDEA_OBJECTIVES_OUTPUT_PROPERTY,
  IDEA_TARGET_USERS_OUTPUT_PROPERTY,
  IDEA_TITLE_OUTPUT_PROPERTY,
  PARTIAL_ABSTRACT_OUTPUT_PROPERTY,
} from './idea-shared-output-fields';

/**
 * Provider-neutral JSON Schema describing the expected response for
 * registered free idea generation.
 *
 * This schema must remain synchronized with:
 * - FREE_OUTPUT_FORMAT
 * - FreeIdeaSchema
 * - The registered free-generation prompt template
 *
 * AI-provider adapters may translate this schema into their native
 * structured-output representation.
 *
 * Central runtime validation remains mandatory after receiving the
 * provider response.
 *
 * @author Malak
 */
export const FREE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,

  properties: {
    /**
     * Generated software-project title.
     */
    title: IDEA_TITLE_OUTPUT_PROPERTY,

    /**
     * Description of the problem addressed by the project.
     */
    problemStatement: FREE_PROBLEM_STATEMENT_OUTPUT_PROPERTY,

    /**
     * Main project objectives.
     */
    objectives: IDEA_OBJECTIVES_OUTPUT_PROPERTY,

    /**
     * Primary users or organizations targeted by the project.
     */
    targetUsers: IDEA_TARGET_USERS_OUTPUT_PROPERTY,

    /**
     * Partial project abstract available to registered free users.
     */
    partialAbstract: PARTIAL_ABSTRACT_OUTPUT_PROPERTY,
  },

  required: [
    'title',
    'problemStatement',
    'objectives',
    'targetUsers',
    'partialAbstract',
  ],
} as const;

/**
 * Human-readable JSON example inserted into the registered free idea
 * prompt.
 *
 * The AI must return the exact field names and value types demonstrated
 * by this example.
 */
export const FREE_OUTPUT_FORMAT = JSON.stringify(
  {
    ...BASE_IDEA_OUTPUT_FORMAT,
    partialAbstract: 'string',
  },
  null,
  2,
);