import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';
import { COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES } from '../constants/community-ai-analysis.constants';

/**
 * Provider-neutral structured-output contract for community analysis.
 *
 * The schema deliberately validates the stable envelope and score ranges while
 * leaving opportunity aliases tolerant. Different providers sometimes return
 * semantically equivalent keys such as `problemStatement`, `need`, `solution`,
 * `targetUsers`, or `evidence`. CommunityAiAnalysisService normalizes those
 * aliases into the strict internal contract before the result enters ranking.
 */
export function buildCommunityAiAnalysisSchema(): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['opportunities'],
    properties: {
      summary: { type: 'string', maxLength: 1_500 },
      dominantProblems: { type: 'array', maxItems: 12, items: {} },
      unmetNeeds: { type: 'array', maxItems: 12, items: {} },
      opportunities: {
        type: 'array',
        minItems: 1,
        maxItems: COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            domainName: { type: 'string', minLength: 2, maxLength: 120 },
            title: { type: 'string', minLength: 3, maxLength: 180 },
            problem: { type: 'string', minLength: 12, maxLength: 1_000 },
            unmetNeed: { type: 'string', minLength: 8, maxLength: 700 },
            solutionArea: { type: 'string', minLength: 3, maxLength: 300 },
            affectedUsers: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', minLength: 2, maxLength: 180 },
            },
            evidenceSamples: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', minLength: 8, maxLength: 700 },
            },
            frequency: { type: 'number', minimum: 1, maximum: 1_000_000 },
            severity: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            problemImportance: { type: 'number', minimum: 0, maximum: 100 },
            localEvidenceAvailable: { type: 'boolean' },
            localEvidenceSamples: {
              type: 'array',
              maxItems: 5,
              items: { type: 'string', maxLength: 700 },
            },
            localRelevance: { type: 'number', minimum: 0, maximum: 100 },
            technicalFeasibility: { type: 'number', minimum: 0, maximum: 100 },
            marketPotential: { type: 'number', minimum: 0, maximum: 100 },
            innovationPotential: { type: 'number', minimum: 0, maximum: 100 },
            risks: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string', maxLength: 300 },
            },
          },
        },
      },
      overallConfidence: { type: 'number', minimum: 0, maximum: 100 },
      qualityWarnings: { type: 'array', maxItems: 10, items: {} },
    },
  } as const;
}