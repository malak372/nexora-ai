import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';

export function buildRequestCollectionPlanSchema(
  _activeSourceKeys: readonly string[] = [],
): AiJsonSchema {
  /*
   * Keep the provider schema byte-for-byte stable across requests. The active
   * source catalog is request-specific, so embedding it as an enum while
   * reusing one responseSchemaName makes providers reject later requests with
   * "schema name reused with a different JSON Schema". Source keys are
   * still validated against the live catalog in RequestCollectionPlanningService.
   */
  const sourceKeySchema = {
    type: 'string',
    minLength: 2,
    maxLength: 60,
  } as const;

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'domainSelectionMode',
      'selectedExistingDomainId',
      'suggestedDomainName',
      'domainIdentity',
      'existingDomainMatchScore',
      'searchQueries',
      'evidenceTargets',
      'intentConcepts',
      'sourcePlans',
      'confidence',
    ],
    properties: {
      domainSelectionMode: {
        type: 'string',
        minLength: 2,
        maxLength: 40,
      },
      selectedExistingDomainId: {
        anyOf: [
          { type: 'string', minLength: 8, maxLength: 80 },
          { type: 'null' },
        ],
      },
      suggestedDomainName: {
        anyOf: [
          { type: 'string', minLength: 3, maxLength: 100 },
          { type: 'null' },
        ],
      },
      domainIdentity: {
        type: 'object',
        additionalProperties: false,
        required: ['actor', 'object', 'workflow', 'failure'],
        properties: {
          actor: { type: 'string', minLength: 3, maxLength: 160 },
          object: { type: 'string', minLength: 3, maxLength: 160 },
          workflow: { type: 'string', minLength: 3, maxLength: 160 },
          failure: { type: 'string', minLength: 3, maxLength: 160 },
        },
      },
      existingDomainMatchScore: {
        type: 'number',
        minimum: 0,
        maximum: 100,
      },
      searchQueries: {
        type: 'array',
        minItems: 8,
        maxItems: 16,
        items: { type: 'string', minLength: 8, maxLength: 200 },
      },
      evidenceTargets: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        items: { type: 'string', minLength: 6, maxLength: 260 },
      },
      intentConcepts: {
        type: 'array',
        minItems: 3,
        maxItems: 12,
        items: { type: 'string', minLength: 3, maxLength: 140 },
      },
      sourcePlans: {
        type: 'array',
        minItems: 1,
        maxItems: 7,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceKey', 'queries', 'routingHints'],
          properties: {
            sourceKey: sourceKeySchema,
            queries: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', minLength: 6, maxLength: 200 },
            },
            routingHints: {
              type: 'array',
              minItems: 0,
              maxItems: 4,
              items: { type: 'string', minLength: 3, maxLength: 180 },
            },
          },
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
    },
  } as const;
}
