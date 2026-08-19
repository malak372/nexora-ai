import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';

export function buildRequestCollectionPlanSchema(): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'suggestedDomainName',
      'searchQueries',
      'evidenceTargets',
      'intentConcepts',
      'sourceFocus',
      'confidence',
    ],
    properties: {
      suggestedDomainName: {
        anyOf: [
          { type: 'string', minLength: 3, maxLength: 80 },
          { type: 'null' },
        ],
      },
      searchQueries: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: { type: 'string', minLength: 12, maxLength: 140 },
      },
      evidenceTargets: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: { type: 'string', minLength: 6, maxLength: 120 },
      },
      intentConcepts: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        items: { type: 'string', minLength: 3, maxLength: 80 },
      },
      sourceFocus: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'string',
          enum: [
            'REVIEWS',
            'FORUMS',
            'TECHNICAL',
            'NEWS',
            'PRODUCT_DISCOVERY',
          ],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
    },
  } as const;
}
