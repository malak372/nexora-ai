import type { Prisma } from '@prisma/client';

/**
 * Supported evidence categories used while ranking product opportunities.
 *
 * @author Malak
 */
export const IDEA_OPPORTUNITY_EVIDENCE_TYPES = {
  PROBLEM: 'PROBLEM',
  NEED: 'NEED',
  FEATURE_REQUEST: 'FEATURE_REQUEST',
  OPPORTUNITY: 'OPPORTUNITY',
} as const;

/** Evidence category attached to a ranked opportunity. */
export type IdeaOpportunityEvidenceType =
  (typeof IDEA_OPPORTUNITY_EVIDENCE_TYPES)[keyof typeof IDEA_OPPORTUNITY_EVIDENCE_TYPES];

/**
 * One normalized and scored opportunity discovered from persisted NLP output.
 *
 * Scores use a zero-to-one scale so the ranking contract remains independent
 * from any AI-provider scoring convention.
 *
 * @author Malak
 */
export type RankedIdeaOpportunity = {
  readonly rank: number;
  readonly title: string;
  readonly problem: string | null;
  readonly need: string | null;
  readonly solutionArea: string | null;
  readonly evidenceType: IdeaOpportunityEvidenceType;
  readonly sourceIndex: number;
  readonly frequency: number;
  readonly severity: string | null;
  readonly evidenceSamples: readonly string[];
  readonly frequencyScore: number;
  readonly severityScore: number;
  readonly evidenceScore: number;
  readonly specificityScore: number;
  readonly feasibilityScore: number;
  readonly localRelevanceScore: number;
  readonly finalScore: number;
  readonly raw: Prisma.JsonValue;
};

/**
 * Deterministic opportunity-ranking result stored in the generation context.
 *
 * @author Malak
 */
export type IdeaOpportunityRanking = {
  readonly selected: RankedIdeaOpportunity;
  readonly alternatives: readonly RankedIdeaOpportunity[];
  readonly evaluatedCount: number;
  readonly evidenceCoverage: number;
  readonly qualityWarnings: readonly string[];
};