import {
  ADVANCED_IDEA_OUTPUT_FORMAT,
  ADVANCED_IDEA_OUTPUT_PROPERTIES,
  ADVANCED_IDEA_REQUIRED_FIELDS,
  FULL_ABSTRACT_OUTPUT_PROPERTY,
} from './idea-shared-output-fields';

/**
 * Provider-neutral JSON Schema describing the expected response for
 * direct idea-unlock requests.
 *
 * Direct unlock expands an existing NORMAL_FREE idea and returns only
 * advanced project-planning content.
 *
 * Existing basic fields must not be regenerated:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - partialAbstract
 *
 * Trusted NLP data is loaded directly from NlpAnalysis and appended
 * later by IdeasService or a dedicated response builder.
 *
 * This schema must remain synchronized with:
 * - UNLOCK_OUTPUT_FORMAT
 * - UnlockIdeaSchema
 * - The idea-unlock prompt template
 *
 * @author Malak
 */
export const UNLOCK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,

  properties: {
    /**
     * Complete abstract expanding the existing free-tier idea.
     */
    fullAbstract: FULL_ABSTRACT_OUTPUT_PROPERTY,

    /**
     * Shared advanced project-planning fields.
     */
    ...ADVANCED_IDEA_OUTPUT_PROPERTIES,
  },

  required: ['fullAbstract', ...ADVANCED_IDEA_REQUIRED_FIELDS],
} as const;

/**
 * Human-readable JSON example inserted into the idea-unlock prompt.
 *
 * The AI must follow these exact field names and value types.
 *
 * Existing basic idea fields, trusted NLP values, and collection
 * metadata are intentionally excluded.
 */
export const UNLOCK_OUTPUT_FORMAT = JSON.stringify(
  {
    fullAbstract: 'string',
    ...ADVANCED_IDEA_OUTPUT_FORMAT,
  },
  null,
  2,
);
