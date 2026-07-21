import { Injectable } from '@nestjs/common';

import type { PriorityLevel } from '../pipeline/types/intelligent-analysis.types';

type ProblemSeverityInput = {
  readonly frequency: number;
  readonly negativeSignals: number;
  readonly urgencySignals: number;
};

const PROBLEM_SEVERITY_THRESHOLDS = {
  high: {
    frequency: 5,
    negativeSignals: 4,
    urgencySignals: 2,
  },
  medium: {
    frequency: 3,
    negativeSignals: 2,
    urgencySignals: 1,
  },
} as const;

const PROBLEM_SEVERITY_WEIGHTS: Readonly<
  Record<PriorityLevel, number>
> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Determines recurring problem severity using deterministic thresholds.
 *
 * Keeping severity rules separate from extraction makes the NLP engine easier
 * to test, tune, and extend without modifying problem aggregation logic.
 *
 * @author Eman
 */
@Injectable()
export class ProblemSeverityPolicyService {
  /**
   * Calculates the severity of a recurring problem.
   *
   * A problem reaches a severity level when at least one corresponding
   * threshold is met.
   *
   * @param input Frequency, negative-signal, and urgency-signal counts.
   * @returns Problem severity.
   */
  calculate(input: ProblemSeverityInput): PriorityLevel {
    const normalizedInput =
      this.normalizeInput(input);

    if (
      normalizedInput.frequency >=
      PROBLEM_SEVERITY_THRESHOLDS.high.frequency ||
      normalizedInput.negativeSignals >=
      PROBLEM_SEVERITY_THRESHOLDS.high.negativeSignals ||
      normalizedInput.urgencySignals >=
      PROBLEM_SEVERITY_THRESHOLDS.high.urgencySignals
    ) {
      return 'HIGH';
    }

    if (
      normalizedInput.frequency >=
      PROBLEM_SEVERITY_THRESHOLDS.medium.frequency ||
      normalizedInput.negativeSignals >=
      PROBLEM_SEVERITY_THRESHOLDS.medium.negativeSignals ||
      normalizedInput.urgencySignals >=
      PROBLEM_SEVERITY_THRESHOLDS.medium.urgencySignals
    ) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Converts severity into a sortable numeric weight.
   *
   * @param severity Severity level.
   * @returns Numeric severity weight.
   */
  getWeight(severity: PriorityLevel): number {
    return PROBLEM_SEVERITY_WEIGHTS[severity];
  }

  /**
   * Protects severity calculations from negative or non-finite counters.
   *
   * @param input Raw severity counters.
   * @returns Safe non-negative integer counters.
   */
  private normalizeInput(
    input: ProblemSeverityInput,
  ): ProblemSeverityInput {
    return {
      frequency: this.normalizeCounter(input.frequency),
      negativeSignals: this.normalizeCounter(
        input.negativeSignals,
      ),
      urgencySignals: this.normalizeCounter(
        input.urgencySignals,
      ),
    };
  }

  /**
   * Normalizes one numeric counter.
   *
   * @param value Raw counter.
   * @returns Safe non-negative integer.
   */
  private normalizeCounter(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.floor(value);
  }
}