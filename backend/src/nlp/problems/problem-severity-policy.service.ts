import { Injectable } from '@nestjs/common';

import type { PriorityLevel } from '../pipeline/types/intelligent-analysis.types';

type ProblemSeverityInput = {
  readonly frequency: number;
  readonly negativeSignals: number;
  readonly urgencySignals: number;
  readonly blockingSignals?: number;
  readonly criticalOperationalSignals?: number;
  readonly averageEvidenceQuality?: number;
};

const PROBLEM_SEVERITY_THRESHOLDS = {
  high: {
    frequency: 5,
    negativeSignals: 4,
    urgencySignals: 2,
    blockingSignals: 2,
    criticalOperationalSignals: 2,
  },
  medium: {
    frequency: 3,
    negativeSignals: 2,
    urgencySignals: 1,
    blockingSignals: 1,
    criticalOperationalSignals: 1,
  },
} as const;

const PROBLEM_SEVERITY_WEIGHTS: Readonly<Record<PriorityLevel, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Determines recurring-problem severity from frequency, sentiment, urgency,
 * operational impact, and evidence quality.
 *
 * @author Eman
 */
@Injectable()
export class ProblemSeverityPolicyService {
  /** Calculates the severity of a recurring problem. */
  calculate(input: ProblemSeverityInput): PriorityLevel {
    const normalized = this.normalizeInput(input);
    const evidenceQuality = this.normalizeScore(input.averageEvidenceQuality);

    const hasHighOperationalImpact =
      normalized.blockingSignals >=
        PROBLEM_SEVERITY_THRESHOLDS.high.blockingSignals ||
      normalized.criticalOperationalSignals >=
        PROBLEM_SEVERITY_THRESHOLDS.high.criticalOperationalSignals;

    if (
      hasHighOperationalImpact ||
      normalized.frequency >= PROBLEM_SEVERITY_THRESHOLDS.high.frequency ||
      normalized.negativeSignals >=
        PROBLEM_SEVERITY_THRESHOLDS.high.negativeSignals ||
      normalized.urgencySignals >=
        PROBLEM_SEVERITY_THRESHOLDS.high.urgencySignals
    ) {
      return evidenceQuality >= 0.45 || hasHighOperationalImpact
        ? 'HIGH'
        : 'MEDIUM';
    }

    const hasMediumOperationalImpact =
      normalized.blockingSignals >=
        PROBLEM_SEVERITY_THRESHOLDS.medium.blockingSignals ||
      normalized.criticalOperationalSignals >=
        PROBLEM_SEVERITY_THRESHOLDS.medium.criticalOperationalSignals;

    if (
      hasMediumOperationalImpact ||
      normalized.frequency >= PROBLEM_SEVERITY_THRESHOLDS.medium.frequency ||
      normalized.negativeSignals >=
        PROBLEM_SEVERITY_THRESHOLDS.medium.negativeSignals ||
      normalized.urgencySignals >=
        PROBLEM_SEVERITY_THRESHOLDS.medium.urgencySignals
    ) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /** Converts severity into a sortable numeric weight. */
  getWeight(severity: PriorityLevel): number {
    return PROBLEM_SEVERITY_WEIGHTS[severity];
  }

  private normalizeInput(
    input: ProblemSeverityInput,
  ): Required<Omit<ProblemSeverityInput, 'averageEvidenceQuality'>> {
    return {
      frequency: this.normalizeCounter(input.frequency),
      negativeSignals: this.normalizeCounter(input.negativeSignals),
      urgencySignals: this.normalizeCounter(input.urgencySignals),
      blockingSignals: this.normalizeCounter(input.blockingSignals ?? 0),
      criticalOperationalSignals: this.normalizeCounter(
        input.criticalOperationalSignals ?? 0,
      ),
    };
  }

  private normalizeCounter(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.floor(value);
  }

  private normalizeScore(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    return Math.min(1, Math.max(0, value));
  }
}
