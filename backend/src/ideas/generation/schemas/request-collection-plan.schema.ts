import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';

/**
 * Strict provider-facing PREPARING schema.
 *
 * The prompt contract requires exactly one JSON object. Previous versions used
 * a root-level anyOf to also accept one-item arrays and wrapper objects. Some
 * Gemini/OpenRouter structured-output implementations reject that union before
 * application-side unwrapping can run, which unnecessarily forces the pipeline
 * into deterministic fallback. Keep the provider schema simple and canonical;
 * RequestCollectionPlanningService still performs defensive JSON unwrapping for
 * providers that ignore the schema and return a harmless wrapper as plain text.
 */
export function buildRequestCollectionPlanSchema(): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'domainSelectionMode',
      'selectedExistingDomainId',
      'suggestedDomainName',
      'domainIdentity',
      'searchQueries',
      'selectedSourceKeys',
      'confidence',
    ],
    properties: {
      domainSelectionMode: {
        type: 'string',
        enum: ['EXISTING', 'NEW'],
      },
      selectedExistingDomainId: {
        type: 'string',
        maxLength: 180,
      },
      suggestedDomainName: {
        type: 'string',
        maxLength: 180,
      },
      domainIdentity: {
        type: 'object',
        additionalProperties: false,
        required: ['actor', 'object', 'workflow', 'failure'],
        properties: {
          actor: { type: 'string', minLength: 1, maxLength: 160 },
          object: { type: 'string', minLength: 1, maxLength: 180 },
          workflow: { type: 'string', minLength: 1, maxLength: 220 },
          failure: { type: 'string', minLength: 1, maxLength: 220 },
        },
      },
      searchQueries: {
        type: 'array',
        minItems: 6,
        maxItems: 6,
        items: { type: 'string', minLength: 8, maxLength: 140 },
      },
      selectedSourceKeys: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        uniqueItems: true,
        items: { type: 'string', minLength: 2, maxLength: 80 },
      },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
    },
  } as const;
}
