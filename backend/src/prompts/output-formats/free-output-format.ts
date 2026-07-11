/**
 * Provider-neutral JSON schema describing the expected
 * response for registered free idea generation.
 *
 * This schema must remain synchronized with:
 * - FREE_OUTPUT_FORMAT
 * - FreeIdeaSchema
 *
 * AI provider adapters may transform this schema into
 * their provider-specific structured-output representation.
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
    title: {
      type: 'string',
      minLength: 3,
      maxLength: 200,
    },

    /**
     * Description of the problem addressed by the project.
     */
    problemStatement: {
      type: 'string',
      minLength: 20,
      maxLength: 1_200,
    },

    /**
     * Main project objectives.
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
     * Primary users or organizations targeted by the project.
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
     * Partial project abstract available to registered free users.
     */
    partialAbstract: {
      type: 'string',
      minLength: 30,
      maxLength: 2_500,
    },
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
 * Human-readable JSON example inserted into the prompt.
 *
 * The AI must return the exact field names and value types
 * demonstrated by this example.
 */
export const FREE_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',
    problemStatement: 'string',
    objectives: ['string'],
    targetUsers: ['string'],
    partialAbstract: 'string',
  },
  null,
  2,
);