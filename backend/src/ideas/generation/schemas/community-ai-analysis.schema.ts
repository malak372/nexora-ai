import type { AiJsonSchema } from '../../../ai/types/ai-json-schema.type';
import {
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
  COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ITEMS_PER_REQUEST,
} from '../constants/community-ai-analysis.constants';

/**
 * Compact provider-facing schema for community analysis.
 *
 * Only fields that are required to preserve grounding are mandatory at the
 * provider boundary. The service deterministically repairs optional semantic
 * fields from the retained evidence before business validation. Domains-only
 * generation may also tolerate a provider omitting evidenceSamples because the
 * normal corpus-grounding layer can attach only semantically matching retained
 * evidence; unsupported opportunities are still rejected.
 */
export function buildCommunityAiAnalysisSchema(options?: {
  readonly requireEvidenceSamples?: boolean;
  readonly requireEvidenceClassifications?: boolean;
}): AiJsonSchema {
  const requireEvidenceSamples = options?.requireEvidenceSamples !== false;
  const requireEvidenceClassifications =
    options?.requireEvidenceClassifications === true;
  return {
    type: 'object',
    additionalProperties: false,
    required: requireEvidenceClassifications
      ? ['opportunities', 'evidenceClassifications']
      : ['opportunities'],
    properties: {
      summary: { type: 'string', maxLength: 260 },
      dominantProblems: {
        type: 'array',
        maxItems: 2,
        items: { type: 'string', maxLength: 220 },
      },
      unmetNeeds: {
        type: 'array',
        maxItems: 2,
        items: { type: 'string', maxLength: 220 },
      },
      opportunities: {
        type: 'array',
        minItems: 0,
        maxItems: COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: requireEvidenceSamples ? ['evidenceSamples'] : [],
          properties: {
            domainName: { type: 'string', maxLength: 100 },
            title: { type: 'string', maxLength: 120 },
            problem: { type: 'string', maxLength: 360 },
            unmetNeed: { type: 'string', maxLength: 260 },
            solutionArea: { type: 'string', maxLength: 260 },
            affectedUsers: {
              type: 'array',
              maxItems: 3,
              items: { type: 'string', maxLength: 100 },
            },
            evidenceSamples: {
              type: 'array',
              minItems: 1,
              maxItems: 2,
              items: { type: 'string', maxLength: 520 },
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
              maxItems: 1,
              items: { type: 'string', maxLength: 520 },
            },
            localRelevance: { type: 'number', minimum: 0, maximum: 100 },
            technicalFeasibility: { type: 'number', minimum: 0, maximum: 100 },
            marketPotential: { type: 'number', minimum: 0, maximum: 100 },
            innovationPotential: { type: 'number', minimum: 0, maximum: 100 },
            risks: {
              type: 'array',
              maxItems: 2,
              items: { type: 'string', maxLength: 180 },
            },
          },
        },
      },
      ...(requireEvidenceClassifications
        ? {
            evidenceClassifications: {
              type: 'array',
              maxItems: 64,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'evidenceId',
                  'classification',
                  'confidence',
                  'reason',
                ],
                properties: {
                  evidenceId: { type: 'string', maxLength: 220 },
                  classification: {
                    type: 'string',
                    enum: [
                      'DIRECT_PROBLEM',
                      'SUPPORTING_SIGNAL',
                      'CONTEXT_ONLY',
                      'UNRELATED',
                    ],
                  },
                  confidence: { type: 'number', minimum: 0, maximum: 100 },
                  reason: { type: 'string', maxLength: 220 },
                  problemFamily: { type: 'string', maxLength: 120 },
                },
              },
            },
          }
        : {}),
      overallConfidence: { type: 'number', minimum: 0, maximum: 100 },
      qualityWarnings: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', maxLength: 200 },
      },
    },
  } as const;
}

/**
 * Small structured-output contract used only for raw evidence classification.
 * Opportunity synthesis is deliberately excluded so a large raw corpus can be
 * classified without producing an oversized JSON response.
 */
export function buildCommunityAiEvidenceTriageSchema(): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ITEMS_PER_REQUEST,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['evidenceId'],
          properties: {
            evidenceId: { type: 'string', maxLength: 220 },
            classification: {
              type: 'string',
              enum: ['DIRECT_PROBLEM', 'SUPPORTING_SIGNAL', 'CONTEXT_ONLY', 'UNRELATED'],
            },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            problemFamily: { type: 'string', maxLength: 240 },
          },
        },
      },
    },
  } as const;
}

