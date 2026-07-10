import { Injectable } from '@nestjs/common';

import { PriorityLevel } from '../pipeline/types/intelligent-analysis.types';

type ProblemSeverityInput = {
  frequency: number;
  negativeSignals: number;
  urgencySignals: number;
};

/**
 * Determines recurring problem severity using configurable analysis thresholds.
 *
 * This service keeps severity rules separated from problem extraction logic,
 * making the NLP engine easier to test, tune, and extend.
 *
 * @author Eman
 */
@Injectable()
export class ProblemSeverityPolicyService {
  private readonly thresholds = {
    highFrequency: 5,
    mediumFrequency: 3,
    highNegativeSignals: 4,
    mediumNegativeSignals: 2,
    highUrgencySignals: 2,
    mediumUrgencySignals: 1,
  };

  /**
   * Calculates the severity level for a recurring problem.
   *
   * @param input Frequency and signal counts for the detected problem.
   * @returns Problem severity level.
   */
  calculate(input: ProblemSeverityInput): PriorityLevel {
    if (
      input.frequency >= this.thresholds.highFrequency ||
      input.negativeSignals >= this.thresholds.highNegativeSignals ||
      input.urgencySignals >= this.thresholds.highUrgencySignals
    ) {
      return 'HIGH';
    }

    if (
      input.frequency >= this.thresholds.mediumFrequency ||
      input.negativeSignals >= this.thresholds.mediumNegativeSignals ||
      input.urgencySignals >= this.thresholds.mediumUrgencySignals
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
    const weights: Record<PriorityLevel, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
    };

    return weights[severity];
  }
}
