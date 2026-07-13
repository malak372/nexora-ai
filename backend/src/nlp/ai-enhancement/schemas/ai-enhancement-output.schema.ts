import {
  MAX_AI_EVIDENCE_IDS_PER_ITEM,
  MAX_AI_EXTRACTED_NEEDS,
  MAX_AI_FEATURE_REQUESTS,
  MAX_AI_INSIGHTS,
  MAX_AI_OPPORTUNITIES,
  MAX_AI_RECURRING_PROBLEMS,
} from '../constants/ai-enhancement.constants';

import { JsonSchema } from '../../../prompts/types/json-schema.type';

/**
 * Stable provider-neutral name assigned to the NLP AI-enhancement
 * structured-output schema.
 *
 * AI provider adapters may use this value when registering
 * structured-output contracts or tool definitions.
 *
 * @author Eman
 */
export const AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME = 'nexora_nlp_ai_enhancement';

/**
 * Provider-neutral JSON Schema describing the structured response
 * expected from one NLP AI-enhancement operation.
 *
 * The schema is intentionally strict:
 * - Every object rejects undeclared properties.
 * - Every analytical item must reference existing evidence.
 * - Confidence and severity values are limited to [0, 1].
 * - Collection sizes are limited by application constants.
 * - Evidence identifiers must be unique within each item.
 *
 * Provider adapters may convert this schema into:
 * - OpenRouter structured outputs.
 * - Groq JSON mode.
 * - Google structured outputs.
 *
 * @author Eman
 */
export const AI_ENHANCEMENT_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',

  type: 'object',

  additionalProperties: false,

  required: [
    'recurringProblems',
    'extractedNeeds',
    'featureRequests',
    'opportunities',
    'insights',
    'confidence',
  ],

  properties: {
    recurringProblems: {
      type: 'array',

      maxItems: MAX_AI_RECURRING_PROBLEMS,

      items: {
        type: 'object',

        additionalProperties: false,

        required: ['title', 'description', 'severity', 'supportingEvidenceIds'],

        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },

          description: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 1_000,
          },

          severity: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },

          supportingEvidenceIds: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_AI_EVIDENCE_IDS_PER_ITEM,
            uniqueItems: true,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 150,
            },
          },
        },
      },
    },

    extractedNeeds: {
      type: 'array',

      maxItems: MAX_AI_EXTRACTED_NEEDS,

      items: {
        type: 'object',

        additionalProperties: false,

        required: ['need', 'confidence', 'supportingEvidenceIds'],

        properties: {
          need: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },

          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },

          supportingEvidenceIds: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_AI_EVIDENCE_IDS_PER_ITEM,
            uniqueItems: true,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 150,
            },
          },
        },
      },
    },

    featureRequests: {
      type: 'array',

      maxItems: MAX_AI_FEATURE_REQUESTS,

      items: {
        type: 'object',

        additionalProperties: false,

        required: ['feature', 'confidence', 'supportingEvidenceIds'],

        properties: {
          feature: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },

          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },

          supportingEvidenceIds: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_AI_EVIDENCE_IDS_PER_ITEM,
            uniqueItems: true,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 150,
            },
          },
        },
      },
    },

    opportunities: {
      type: 'array',

      maxItems: MAX_AI_OPPORTUNITIES,

      items: {
        type: 'object',

        additionalProperties: false,

        required: [
          'title',
          'description',
          'confidence',
          'supportingEvidenceIds',
        ],

        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },

          description: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 1_000,
          },

          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },

          supportingEvidenceIds: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_AI_EVIDENCE_IDS_PER_ITEM,
            uniqueItems: true,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 150,
            },
          },
        },
      },
    },

    insights: {
      type: 'array',

      maxItems: MAX_AI_INSIGHTS,

      items: {
        type: 'object',

        additionalProperties: false,

        required: ['insight', 'confidence', 'supportingEvidenceIds'],

        properties: {
          insight: {
            type: 'string',
            minLength: 1,
            maxLength: 750,
          },

          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },

          supportingEvidenceIds: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_AI_EVIDENCE_IDS_PER_ITEM,
            uniqueItems: true,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 150,
            },
          },
        },
      },
    },

    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
} as const satisfies JsonSchema;
