import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';
import { COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES } from '../constants/community-ai-analysis.constants';

/**
 * Provider-compatible structured-output contract for community analysis.
 *
 * Empty item schemas caused some providers to reject the request itself with
 * "Request contains an invalid argument". This concrete schema is accepted by
 * Gemini-style structured-output APIs and still allows runtime normalization
 * of optional aliases and evidence fields.
 */
export function buildCommunityAiAnalysisSchema(): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'opportunities', 'overallConfidence'],
    properties: {
      summary: { type: 'string', maxLength: 300 },
      dominantProblems: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', maxLength: 220 },
      },
      unmetNeeds: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', maxLength: 220 },
      },
      opportunities: {
        type: 'array',
        minItems: 1,
        maxItems: COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'problem',
            'unmetNeed',
            'solutionArea',
            'targetUsers',
            'evidence',
            'confidence',
          ],
          properties: {
            title: { type: 'string', maxLength: 120 },
            problem: { type: 'string', maxLength: 420 },
            unmetNeed: { type: 'string', maxLength: 300 },
            solutionArea: { type: 'string', maxLength: 500 },
            targetUsers: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', maxLength: 100 },
            },
            evidence: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string', maxLength: 260 },
            },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
      overallConfidence: { type: 'number', minimum: 0, maximum: 100 },
      qualityWarnings: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', maxLength: 220 },
      },
    },
  } as const;
}