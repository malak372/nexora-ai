import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  IDEA_OPPORTUNITY_EVIDENCE_TYPES,
  type IdeaOpportunityEvidenceType,
  type IdeaOpportunityRanking,
  type RankedIdeaOpportunity,
} from '../types/idea-opportunity-ranking.type';
import type { IdeaGenerationNlpContext } from '../types/idea-generation-context.type';

/** Maximum evidence samples retained for one ranked opportunity. */
const MAX_EVIDENCE_SAMPLES = 5;

/** Maximum ranked alternatives exposed to the prompt-building stage. */
const MAX_RANKED_OPPORTUNITIES = 8;

/** Generic labels that must not dominate opportunity selection. */
const GENERIC_LABELS = new Set([
  'app',
  'application',
  'issue',
  'need',
  'platform',
  'problem',
  'service',
  'solution',
  'system',
]);

/** Severity values mapped to a zero-to-one score. */
const SEVERITY_SCORES: Readonly<Record<string, number>> = {
  CRITICAL: 1,
  HIGH: 0.85,
  MEDIUM: 0.6,
  LOW: 0.35,
};

/**
 * Converts persisted NLP output into a deterministic, evidence-aware ranking.
 *
 * The service deliberately avoids an additional AI request. It ranks existing
 * evidence using stable rules so generation remains reproducible, inexpensive,
 * and available even when one provider is rate-limited.
 *
 * @author Malak
 */
@Injectable()
export class IdeaOpportunityRankingService {
  /**
   * Ranks problems, needs, feature requests, and NLP opportunities.
   *
   * @param nlp Validated NLP context.
   * @param locationTerms Normalized country, city, and region values.
   * @returns Ranked opportunity selection for prompt grounding.
   */
  rank(
    nlp: IdeaGenerationNlpContext,
    locationTerms: readonly string[],
  ): IdeaOpportunityRanking {
    const candidates = [
      ...this.extractCandidates(
        nlp.recurringProblems,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM,
      ),
      ...this.extractCandidates(
        nlp.extractedNeeds,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED,
      ),
      ...this.extractCandidates(
        nlp.featureRequests,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.FEATURE_REQUEST,
      ),
      ...this.extractCandidates(
        nlp.opportunities,
        IDEA_OPPORTUNITY_EVIDENCE_TYPES.OPPORTUNITY,
      ),
    ];

    const ranked = candidates
      .map((candidate) => this.scoreCandidate(candidate, locationTerms))
      .filter((candidate) => candidate.title.length > 0)
      .sort((first, second) => {
        const scoreDifference = second.finalScore - first.finalScore;
        return scoreDifference !== 0
          ? scoreDifference
          : second.evidenceSamples.length - first.evidenceSamples.length;
      })
      .slice(0, MAX_RANKED_OPPORTUNITIES)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    if (ranked.length === 0) {
      throw new Error(
        'NLP analysis did not contain a usable problem, need, feature request, or opportunity.',
      );
    }

    const evidenceBacked = ranked.filter(
      (candidate) => candidate.evidenceSamples.length > 0,
    ).length;

    const evidenceCoverage = this.round(
      evidenceBacked / Math.max(ranked.length, 1),
    );

    return {
      selected: ranked[0],
      alternatives: ranked.slice(1),
      evaluatedCount: candidates.length,
      evidenceCoverage,
      qualityWarnings: this.buildQualityWarnings(nlp, ranked, evidenceCoverage),
    };
  }

  /** Extracts array-shaped NLP values into normalized candidates. */
  private extractCandidates(
    value: Prisma.JsonValue | null,
    evidenceType: IdeaOpportunityEvidenceType,
  ): Array<{
    title: string;
    problem: string | null;
    need: string | null;
    solutionArea: string | null;
    evidenceType: IdeaOpportunityEvidenceType;
    sourceIndex: number;
    frequency: number;
    severity: string | null;
    evidenceSamples: string[];
    raw: Prisma.JsonValue;
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((entry, sourceIndex) => {
      if (!this.isJsonObject(entry)) {
        return [];
      }

      const problem = this.readString(entry.problem) ??
        (evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.PROBLEM
          ? this.readString(entry.title)
          : null);
      const need = this.readString(entry.need) ??
        (evidenceType === IDEA_OPPORTUNITY_EVIDENCE_TYPES.NEED
          ? this.readString(entry.title)
          : null);
      const solutionArea = this.readString(entry.solutionArea);
      const title =
        this.readString(entry.title) ??
        problem ??
        need ??
        solutionArea ??
        this.readString(entry.topic) ??
        this.readString(entry.feature) ??
        this.readString(entry.request) ??
        '';

      return [
        {
          title,
          problem,
          need,
          solutionArea,
          evidenceType,
          sourceIndex,
          frequency: this.readNumber(entry.frequency),
          severity: this.readString(entry.severity)?.toUpperCase() ?? null,
          evidenceSamples: this.readStringArray(entry.evidenceSamples),
          raw: entry,
        },
      ];
    });
  }

  /** Applies deterministic weighted scoring to one normalized candidate. */
  private scoreCandidate(
    candidate: ReturnType<IdeaOpportunityRankingService['extractCandidates']>[number],
    locationTerms: readonly string[],
  ): Omit<RankedIdeaOpportunity, 'rank'> {
    const frequencyScore = Math.min(Math.log2(candidate.frequency + 1) / 4, 1);
    const severityScore = candidate.severity
      ? (SEVERITY_SCORES[candidate.severity] ?? 0.45)
      : 0.45;
    const evidenceScore = Math.min(
      candidate.evidenceSamples.length / MAX_EVIDENCE_SAMPLES,
      1,
    );
    const specificityScore = this.calculateSpecificity(candidate);
    const feasibilityScore = this.calculateFeasibility(candidate);
    const localRelevanceScore = this.calculateLocalRelevance(
      candidate,
      locationTerms,
    );

    const finalScore = this.round(
      frequencyScore * 0.2 +
        severityScore * 0.18 +
        evidenceScore * 0.24 +
        specificityScore * 0.18 +
        feasibilityScore * 0.12 +
        localRelevanceScore * 0.08,
    );

    return {
      ...candidate,
      evidenceSamples: candidate.evidenceSamples.slice(0, MAX_EVIDENCE_SAMPLES),
      frequencyScore: this.round(frequencyScore),
      severityScore: this.round(severityScore),
      evidenceScore: this.round(evidenceScore),
      specificityScore: this.round(specificityScore),
      feasibilityScore: this.round(feasibilityScore),
      localRelevanceScore: this.round(localRelevanceScore),
      finalScore,
    };
  }

  /** Penalizes generic one-word labels and rewards concrete workflows. */
  private calculateSpecificity(
    candidate: ReturnType<IdeaOpportunityRankingService['extractCandidates']>[number],
  ): number {
    const combined = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
      ...candidate.evidenceSamples,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    const normalizedTitle = candidate.title.trim().toLowerCase();
    const wordCount = combined.split(/\s+/u).filter(Boolean).length;
    const genericPenalty = GENERIC_LABELS.has(normalizedTitle) ? 0.45 : 0;
    const workflowBonus = /download|upload|navigation|login|access|assignment|grade|document|syllabus|scroll|search|payment|booking|delivery|notification/iu.test(
      combined,
    )
      ? 0.25
      : 0;

    return Math.max(
      0,
      Math.min(1, 0.25 + Math.min(wordCount / 80, 0.55) + workflowBonus - genericPenalty),
    );
  }

  /** Rewards software-solvable opportunities and penalizes vague labels. */
  private calculateFeasibility(
    candidate: ReturnType<IdeaOpportunityRankingService['extractCandidates']>[number],
  ): number {
    const text = [
      candidate.title,
      candidate.problem,
      candidate.need,
      candidate.solutionArea,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    if (GENERIC_LABELS.has(candidate.title.trim().toLowerCase())) {
      return 0.35;
    }

    return /app|api|document|workflow|platform|mobile|web|data|analytics|automation|integration|notification|access|search|system/iu.test(
      text,
    )
      ? 0.85
      : 0.65;
  }

  /** Detects direct, evidence-backed location references without inventing them. */
  private calculateLocalRelevance(
    candidate: ReturnType<IdeaOpportunityRankingService['extractCandidates']>[number],
    locationTerms: readonly string[],
  ): number {
    const searchableText = [candidate.title, ...candidate.evidenceSamples]
      .join(' ')
      .toLowerCase();
    const normalizedTerms = locationTerms
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);

    if (normalizedTerms.length === 0) {
      return 0.5;
    }

    return normalizedTerms.some((term) => searchableText.includes(term))
      ? 1
      : 0.4;
  }

  /** Produces warnings used for traceability and prompt cautioning. */
  private buildQualityWarnings(
    nlp: IdeaGenerationNlpContext,
    ranked: readonly RankedIdeaOpportunity[],
    evidenceCoverage: number,
  ): string[] {
    const warnings: string[] = [];

    if (nlp.totalTextsAnalyzed < 80) {
      warnings.push(
        `Only ${nlp.totalTextsAnalyzed} texts were analyzed; treat market-wide conclusions as preliminary.`,
      );
    }

    if (evidenceCoverage < 0.6) {
      warnings.push(
        'Several ranked opportunities lack representative evidence samples.',
      );
    }

    if (GENERIC_LABELS.has(ranked[0].title.trim().toLowerCase())) {
      warnings.push(
        'The highest-ranked NLP label is generic; generation must derive a concrete workflow from its evidence samples.',
      );
    }

    return warnings;
  }

  private isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readString(value: Prisma.JsonValue | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized || null;
  }

  private readNumber(value: Prisma.JsonValue | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 0;
  }

  private readStringArray(value: Prisma.JsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, MAX_EVIDENCE_SAMPLES);
  }

  private round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
  }
}