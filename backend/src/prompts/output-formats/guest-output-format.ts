
/**
 * Provider-neutral JSON schema for guest idea generation.
 *
 * The AI generates the complete registered-free idea foundation
 * in one request, but the guest-facing response exposes only:
 * - title
 * - limitedAbstract
 *
 * The remaining fields are persisted internally and become
 * available after the guest registers and the idea ownership
 * is transferred.
 *
 * This avoids making a second AI request during registration.
 *
 * This schema must remain synchronized with:
 * - GUEST_OUTPUT_FORMAT
 * - GuestIdeaSchema
 * - The idea persistence mapper
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
     * Short abstract exposed to the guest.
     */
    limitedAbstract: {
      type: 'string',
      minLength: 20,
      maxLength: 1_200,
    },

    /**
     * Problem statement persisted internally.
     */
    problemStatement: {
      type: 'string',
      minLength: 20,
      maxLength: 1_200,
    },

    /**
     * Main project objectives persisted internally.
     *
     * The array type is consistent with free and premium outputs.
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
     * Intended project users persisted internally.
     *
     * The array type is consistent with free and premium outputs.
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
     * Partial abstract persisted internally.
     */
    partialAbstract: {
      type: 'string',
      minLength: 30,
      maxLength: 2_500,
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
 * Human-readable JSON example inserted into the guest prompt.
 *
 * Although only title and limitedAbstract are returned to the
 * guest-facing client, every field must be generated.
 */
export const GUEST_OUTPUT_FORMAT = JSON.stringify(
  {
    title: 'string',
    limitedAbstract: 'string',
    problemStatement: 'string',
    objectives: ['string'],
    targetUsers: ['string'],
    partialAbstract: 'string',
  },
  null,
  2,
);
