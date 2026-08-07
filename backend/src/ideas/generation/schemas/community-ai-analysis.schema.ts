import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';
import { COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES } from '../constants/community-ai-analysis.constants';

/**
 * Strict provider-compatible structured-output contract for community analysis.
 *
 * This schema intentionally mirrors CommunityAiOpportunity exactly. Keeping the
 * provider schema and runtime parser aligned prevents valid models from falling
 * back to an empty opportunities array because they were asked for legacy keys
 * such as `targetUsers` / `evidence` while the runtime expects
 * `affectedUsers` / `evidenceSamples`.
 */
export function buildCommunityAiAnalysisSchema(): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'summary',
      'dominantProblems',
      'unmetNeeds',
      'opportunities',
      'overallConfidence',
      'qualityWarnings',
    ],
    properties: {
      summary: { type: 'string', maxLength: 420 },
      dominantProblems: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', maxLength: 320 },
      },
      unmetNeeds: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', maxLength: 320 },
      },
      opportunities: {
        type: 'array',
        minItems: 1,
        maxItems: COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'domainName',
            'title',
            'problem',
            'unmetNeed',
            'solutionArea',
            'affectedUsers',
            'evidenceSamples',
            'frequency',
            'severity',
            'confidence',
            'problemImportance',
            'localEvidenceAvailable',
            'localEvidenceSamples',
            'localRelevance',
            'technicalFeasibility',
            'marketPotential',
            'innovationPotential',
            'risks',
          ],
          properties: {
            domainName: { type: 'string', maxLength: 100 },
            title: { type: 'string', maxLength: 140 },
            problem: { type: 'string', maxLength: 520 },
            unmetNeed: { type: 'string', maxLength: 360 },
            solutionArea: { type: 'string', maxLength: 420 },
            affectedUsers: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', maxLength: 140 },
            },
            evidenceSamples: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string', maxLength: 700 },
            },
            frequency: { type: 'integer', minimum: 1, maximum: 1000 },
            severity: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            problemImportance: { type: 'number', minimum: 0, maximum: 100 },
            localEvidenceAvailable: { type: 'boolean' },
            localEvidenceSamples: {
              type: 'array',
              maxItems: 3,
              items: { type: 'string', maxLength: 700 },
            },
            localRelevance: { type: 'number', minimum: 0, maximum: 100 },
            technicalFeasibility: { type: 'number', minimum: 0, maximum: 100 },
            marketPotential: { type: 'number', minimum: 0, maximum: 100 },
            innovationPotential: { type: 'number', minimum: 0, maximum: 100 },
            risks: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string', maxLength: 260 },
            },
          },
        },
      },
      overallConfidence: { type: 'number', minimum: 0, maximum: 100 },
      qualityWarnings: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', maxLength: 280 },
      },
    },
  } as const;
}
