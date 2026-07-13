/**
 * Provider-neutral schema for guest idea generation.
 *
 * Only title and limitedAbstract are returned to the guest.
 *
 * The remaining registered free-tier fields are generated and
 * persisted internally. They become visible only after the guest
 * registers and ownership of the idea is transferred.
 *
 * This prevents a second AI request during registration.
 *
 * @author Malak
 */
export const GUEST_OUTPUT_SCHEMA = {
  type: 'object',

  additionalProperties: false,

  properties: {
    title: {
      type: 'string',
      minLength: 3,
      maxLength: 200,
    },

    limitedAbstract: {
      type: 'string',
      minLength: 20,
      maxLength: 1_200,
    },

    problemStatement: {
      type: 'string',
      minLength: 20,
      maxLength: 4_000,
    },

    objectives: {
      type: 'string',
      minLength: 10,
      maxLength: 4_000,
    },

    targetUsers: {
      type: 'string',
      minLength: 3,
      maxLength: 2_000,
    },

    partialAbstract: {
      type: 'string',
      minLength: 20,
      maxLength: 4_000,
    },
  },

  required: [
    'title',
    'limitedAbstract',
    'problemStatement',
    'objectives',
    'targetUsers',
    'partialAbstract',
  ],
} as const;

/**
 * Human-readable JSON structure inserted into the rendered prompt.
 *
 * Although only title and limitedAbstract are exposed to the guest,
 * all fields must be returned by the AI provider.
 */
export const GUEST_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',

    limitedAbstract: 'string',

    problemStatement: 'string',

    objectives: 'string',

    targetUsers: 'string',

    partialAbstract: 'string',
  },
  null,
  2,
);
