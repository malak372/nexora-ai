import {
  BASE_IDEA_OUTPUT_FORMAT,
  FREE_PROBLEM_STATEMENT_OUTPUT_PROPERTY,
  IDEA_OBJECTIVES_OUTPUT_PROPERTY,
  IDEA_TARGET_USERS_OUTPUT_PROPERTY,
  IDEA_TITLE_OUTPUT_PROPERTY,
  LIMITED_ABSTRACT_OUTPUT_PROPERTY,
  PARTIAL_ABSTRACT_OUTPUT_PROPERTY,
} from './idea-shared-output-fields';

/**
 * Provider-neutral JSON Schema describing the expected response for
 * guest idea generation.
 *
 * The AI generates the complete registered-free idea foundation in one
 * request, while the guest-facing response exposes only:
 * - title
 * - limitedAbstract
 *
 * The remaining fields are persisted internally and may become
 * available after registration and successful ownership transfer.
 *
 * This avoids executing a second AI request during registration.
 *
 * This schema must remain synchronized with:
 * - GUEST_OUTPUT_FORMAT
 * - GuestIdeaSchema
 * - The guest-generation prompt template
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
    title: IDEA_TITLE_OUTPUT_PROPERTY,

    /**
     * Short abstract exposed to the guest.
     */
    limitedAbstract: LIMITED_ABSTRACT_OUTPUT_PROPERTY,

    /**
     * Problem statement persisted internally.
     */
    problemStatement: FREE_PROBLEM_STATEMENT_OUTPUT_PROPERTY,

    /**
     * Main project objectives persisted internally.
     */
    objectives: IDEA_OBJECTIVES_OUTPUT_PROPERTY,

    /**
     * Intended project users persisted internally.
     */
    targetUsers: IDEA_TARGET_USERS_OUTPUT_PROPERTY,

    /**
     * Partial abstract persisted internally.
     *
     * This value may become available after registration and successful
     * ownership transfer.
     */
    partialAbstract: PARTIAL_ABSTRACT_OUTPUT_PROPERTY,
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
 * Human-readable JSON example inserted into the guest-generation
 * prompt.
 *
 * Although the guest-facing API exposes only title and limitedAbstract,
 * the AI must generate every field included in this example.
 */
export const GUEST_OUTPUT_FORMAT = JSON.stringify(
  {
    title: BASE_IDEA_OUTPUT_FORMAT.title,
    limitedAbstract: 'string',
    problemStatement: BASE_IDEA_OUTPUT_FORMAT.problemStatement,
    objectives: BASE_IDEA_OUTPUT_FORMAT.objectives,
    targetUsers: BASE_IDEA_OUTPUT_FORMAT.targetUsers,
    partialAbstract: 'string',
  },
  null,
  2,
);