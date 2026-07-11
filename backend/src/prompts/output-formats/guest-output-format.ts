/**
 * Provider-neutral JSON schema describing the expected
 * response for guest idea generation.
 *
 * This schema must remain synchronized with:
 * - GUEST_OUTPUT_FORMAT
 * - GuestIdeaSchema
 *
 * AI provider adapters may transform this schema into
 * their provider-specific structured-output representation.
 *
 * @author Malak
 */
export const GUEST_OUTPUT_SCHEMA = {
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
     * Limited project abstract available to guest users.
     */
    limitedAbstract: {
      type: 'string',
      minLength: 20,
      maxLength: 1_200,
    },
  },
  required: ['title', 'limitedAbstract'],
} as const;

/**
 * Human-readable JSON example inserted into the prompt.
 *
 * The AI must return the exact field names and value types
 * demonstrated by this example.
 */
export const GUEST_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',
    limitedAbstract: 'string',
  },
  null,
  2,
);