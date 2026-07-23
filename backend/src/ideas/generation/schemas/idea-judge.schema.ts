import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';

/**
 * Builds the provider-neutral JSON Schema used by the comparative AI judge.
 *
 * The exact candidate count is embedded into the schema. This prevents a
 * provider from returning only the winner or an incomplete score list while
 * still allowing any number of successful generation models.
 *
 * @param candidateCount Number of successful candidates sent to the judge.
 * @returns Strict structured-output schema for this comparison request.
 * @author Malak
 */
export function buildIdeaJudgeResponseSchema(
  candidateCount: number,
): AiJsonSchema {
  if (!Number.isInteger(candidateCount) || candidateCount < 2) {
    throw new Error('AI judge schema requires at least two candidates.');
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'winnerCandidateId',
      'confidence',
      'reason',
      'requiresLegalVerification',
      'scores',
    ],
    properties: {
      winnerCandidateId: { type: 'string', minLength: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      reason: { type: 'string', minLength: 1, maxLength: 1_200 },
      requiresLegalVerification: { type: 'boolean' },
      scores: {
        type: 'array',
        minItems: candidateCount,
        maxItems: candidateCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'candidateId',
            'localRelevance',
            'problemImportance',
            'innovation',
            'regulatoryFeasibility',
            'technicalFeasibility',
            'marketPotential',
            'implementationClarity',
            'overallScore',
            'strengths',
            'risks',
          ],
          properties: {
            candidateId: { type: 'string', minLength: 1 },
            localRelevance: { type: 'number', minimum: 0, maximum: 100 },
            problemImportance: { type: 'number', minimum: 0, maximum: 100 },
            innovation: { type: 'number', minimum: 0, maximum: 100 },
            regulatoryFeasibility: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            technicalFeasibility: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            marketPotential: { type: 'number', minimum: 0, maximum: 100 },
            implementationClarity: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            overallScore: { type: 'number', minimum: 0, maximum: 100 },
            strengths: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'string', minLength: 1, maxLength: 300 },
            },
            risks: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string', minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
  } as const;
}
