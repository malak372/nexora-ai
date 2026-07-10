/**
 * Provider-neutral JSON schema describing the expected
 * response for free registered users.
 *
 * AI provider adapters may transform this schema into
 * their own structured-output format when supported.
 *
 * @author Malak
 */
export const FREE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,

  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },

    problemStatement: {
      type: 'string',
      minLength: 1,
      maxLength: 1200,
    },

    objectives: {
      type: 'string',
      minLength: 1,
      maxLength: 1200,
    },

    targetUsers: {
      type: 'string',
      minLength: 1,
      maxLength: 800,
    },

    partialAbstract: {
      type: 'string',
      minLength: 1,
      maxLength: 2500,
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
 * Human-readable JSON example inserted into the prompt
 * to illustrate the required response structure.
 */
export const FREE_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',
    problemStatement: 'string',
    objectives: 'string',
    targetUsers: 'string',
    partialAbstract: 'string',
  },
  null,
  2,
);
