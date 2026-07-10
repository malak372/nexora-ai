/**
 * Provider-neutral JSON schema describing the expected
 * guest idea-generation response.
 *
 * AI provider adapters may transform this schema into
 * their own structured-output format when supported.
 *
 * @author Malak
 */
export const GUEST_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,

  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },

    limitedAbstract: {
      type: 'string',
      minLength: 1,
      maxLength: 1200,
    },
  },

  required: ['title', 'limitedAbstract'],
} as const;

/**
 * Human-readable JSON example inserted into the prompt
 * to illustrate the required response structure.
 */
export const GUEST_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',
    limitedAbstract: 'string',
  },
  null,
  2,
);
