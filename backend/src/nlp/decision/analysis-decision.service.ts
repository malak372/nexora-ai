import { BadRequestException, Injectable } from '@nestjs/common';

import { ANALYSIS_DECISION_THRESHOLDS } from './constants/analysis-decision-thresholds';
import type { AnalysisDecisionInput } from './types/analysis-decision-input.type';
import {
  AnalysisDecisionReasonCode,
  type AnalysisDecisionReason,
} from './types/analysis-decision-reason.type';
import {
  AnalysisDecisionAction,
  type AnalysisDecisionResult,
} from './types/analysis-decision.type';

/**
 * Determines whether the rule-based NLP result is sufficient or whether
 * AI enhancement is required.
 *
 * The decision engine evaluates:
 * - Dataset size.
 * - Rule-based analysis quality.
 * - Text complexity.
 *
 * Possible outcomes:
 * - RULE_BASED_ONLY:
 *   The rule-based result is sufficiently reliable.
 *
 * - AI_ENHANCEMENT_REQUIRED:
 *   The dataset contains useful information, but deeper semantic
 *   interpretation may improve the final result.
 *
 * - INSUFFICIENT_DATA:
 *   The available dataset is too small to produce a reliable
 *   aggregated NLP result.
 *
 * This service does not:
 * - Call an AI provider.
 * - Analyze raw text.
 * - Modify NLP results.
 * - Persist decision results.
 *
 * The service is deterministic, stateless, and designed for
 * straightforward unit testing.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisDecisionService {
  /**
   * Evaluates the supplied NLP metrics and returns the final decision.
   *
   * Insufficient data has the highest priority. When enough texts are
   * available, the service evaluates rule-based quality and text
   * complexity to determine whether AI enhancement is required.
   *
   * @param input Dataset size, quality metrics, and complexity metrics.
   *
   * @returns The selected action, suitability score, original metrics,
   * and explainable decision reasons.
   *
   * @throws BadRequestException when counters or metric values are invalid.
   */
  decide(input: AnalysisDecisionInput): AnalysisDecisionResult {
    this.validateInput(input);

    const ruleBasedSuitabilityScore =
      this.calculateRuleBasedSuitabilityScore(input);

    if (this.hasInsufficientData(input)) {
      return {
        action: AnalysisDecisionAction.INSUFFICIENT_DATA,
        ruleBasedSuitabilityScore,
        qualityMetrics: input.qualityMetrics,
        complexityMetrics: input.complexityMetrics,
        reasons: [this.createInsufficientDataReason(input)],
      };
    }

    const enhancementReasons = this.collectAiEnhancementReasons(input);

    if (enhancementReasons.length > 0) {
      return {
        action: AnalysisDecisionAction.AI_ENHANCEMENT_REQUIRED,
        ruleBasedSuitabilityScore,
        qualityMetrics: input.qualityMetrics,
        complexityMetrics: input.complexityMetrics,
        reasons: enhancementReasons,
      };
    }

    return {
      action: AnalysisDecisionAction.RULE_BASED_ONLY,
      ruleBasedSuitabilityScore,
      qualityMetrics: input.qualityMetrics,
      complexityMetrics: input.complexityMetrics,
      reasons: [
        this.createReason(
          AnalysisDecisionReasonCode.STRONG_RULE_BASED_RESULT,
          'The rule-based analysis meets all configured quality and complexity thresholds.',
          1,
        ),
      ],
    };
  }

  /**
   * Determines whether the analyzed dataset is too small to support
   * a reliable aggregate NLP result.
   *
   * @param input Decision input.
   * @returns True when the analyzed text count is below the configured minimum.
   */
  private hasInsufficientData(input: AnalysisDecisionInput): boolean {
    return (
      input.totalAnalyzedTexts <
      ANALYSIS_DECISION_THRESHOLDS.dataset.minimumTexts
    );
  }

  /**
   * Creates the explainable reason returned for insufficient datasets.
   *
   * @param input Decision input.
   * @returns Insufficient-data decision reason.
   */
  private createInsufficientDataReason(
    input: AnalysisDecisionInput,
  ): AnalysisDecisionReason {
    const minimumTexts = ANALYSIS_DECISION_THRESHOLDS.dataset.minimumTexts;

    return this.createReason(
      AnalysisDecisionReasonCode.INSUFFICIENT_TEXTS,
      `Only ${input.totalAnalyzedTexts} texts were analyzed, while at least ${minimumTexts} are required.`,
      1,
    );
  }

  /**
   * Collects every quality or complexity condition indicating that
   * AI enhancement may improve the final NLP result.
   *
   * Quality and complexity evaluation are separated to keep each
   * method focused and easier to maintain and test.
   *
   * @param input Decision input.
   * @returns All triggered AI-enhancement reasons.
   */
  private collectAiEnhancementReasons(
    input: AnalysisDecisionInput,
  ): AnalysisDecisionReason[] {
    return [
      ...this.collectQualityReasons(input),
      ...this.collectComplexityReasons(input),
    ];
  }

  /**
   * Collects rule-based quality conditions that fall below the
   * configured minimum thresholds.
   *
   * Returning all triggered conditions provides explainable decisions
   * suitable for logging, auditing, testing, and future dashboards.
   *
   * @param input Decision input.
   * @returns Triggered quality-related reasons.
   */
  private collectQualityReasons(
    input: AnalysisDecisionInput,
  ): AnalysisDecisionReason[] {
    const reasons: AnalysisDecisionReason[] = [];
    const { qualityMetrics } = input;
    const { quality: thresholds } = ANALYSIS_DECISION_THRESHOLDS;

    this.pushMinimumViolationReason({
      reasons,
      actual: qualityMetrics.confidence,
      minimum: thresholds.minimumConfidence,
      code: AnalysisDecisionReasonCode.LOW_CONFIDENCE,
      label: 'Rule-based confidence',
    });

    this.pushMinimumViolationReason({
      reasons,
      actual: qualityMetrics.resultDensity,
      minimum: thresholds.minimumResultDensity,
      code: AnalysisDecisionReasonCode.LOW_RESULT_DENSITY,
      label: 'Result density',
    });

    this.pushMinimumViolationReason({
      reasons,
      actual: qualityMetrics.evidenceCoverage,
      minimum: thresholds.minimumEvidenceCoverage,
      code: AnalysisDecisionReasonCode.LOW_EVIDENCE_COVERAGE,
      label: 'Evidence coverage',
    });

    this.pushMinimumViolationReason({
      reasons,
      actual: qualityMetrics.dataRetentionRate,
      minimum: thresholds.minimumDataRetentionRate,
      code: AnalysisDecisionReasonCode.LOW_DATA_RETENTION,
      label: 'Data retention rate',
    });

    this.pushMinimumViolationReason({
      reasons,
      actual: qualityMetrics.lexicalCoverage,
      minimum: thresholds.minimumLexicalCoverage,
      code: AnalysisDecisionReasonCode.LOW_LEXICAL_COVERAGE,
      label: 'Lexical coverage',
    });

    return reasons;
  }

  /**
   * Collects text-complexity conditions that exceed the configured
   * maximum thresholds.
   *
   * These conditions indicate that linguistic ambiguity, weak lexicon
   * coverage, or complex sentence structure may reduce the reliability
   * of the rule-based NLP result.
   *
   * @param input Decision input.
   * @returns Triggered complexity-related reasons.
   */
  private collectComplexityReasons(
    input: AnalysisDecisionInput,
  ): AnalysisDecisionReason[] {
    const reasons: AnalysisDecisionReason[] = [];
    const { complexityMetrics } = input;
    const { complexity: thresholds } = ANALYSIS_DECISION_THRESHOLDS;

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.complexityScore,
      maximum: thresholds.maximumComplexityScore,
      code: AnalysisDecisionReasonCode.HIGH_TEXT_COMPLEXITY,
      label: 'Text complexity score',
    });

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.lowConfidenceRatio,
      maximum: thresholds.maximumLowConfidenceRatio,
      code: AnalysisDecisionReasonCode.HIGH_LOW_CONFIDENCE_RATIO,
      label: 'Low-confidence ratio',
    });

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.negationRatio,
      maximum: thresholds.maximumNegationRatio,
      code: AnalysisDecisionReasonCode.HIGH_NEGATION_RATIO,
      label: 'Negation ratio',
    });

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.contrastRatio,
      maximum: thresholds.maximumContrastRatio,
      code: AnalysisDecisionReasonCode.HIGH_CONTRAST_RATIO,
      label: 'Contrast ratio',
    });

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.mixedSentimentRatio,
      maximum: thresholds.maximumMixedSentimentRatio,
      code: AnalysisDecisionReasonCode.HIGH_MIXED_SENTIMENT_RATIO,
      label: 'Mixed-sentiment ratio',
    });

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.multiTopicRatio,
      maximum: thresholds.maximumMultiTopicRatio,
      code: AnalysisDecisionReasonCode.HIGH_MULTI_TOPIC_RATIO,
      label: 'Multi-topic ratio',
    });

    this.pushMaximumViolationReason({
      reasons,
      actual: complexityMetrics.unmatchedLexiconRatio,
      maximum: thresholds.maximumUnmatchedLexiconRatio,
      code: AnalysisDecisionReasonCode.HIGH_UNMATCHED_LEXICON_RATIO,
      label: 'Unmatched-lexicon ratio',
    });

    return reasons;
  }

  /**
   * Appends a reason when a quality metric is below a configured minimum.
   *
   * @param input Minimum-threshold evaluation parameters.
   */
  private pushMinimumViolationReason(input: {
    readonly reasons: AnalysisDecisionReason[];
    readonly actual: number;
    readonly minimum: number;
    readonly code: AnalysisDecisionReasonCode;
    readonly label: string;
  }): void {
    if (input.actual >= input.minimum) {
      return;
    }

    input.reasons.push(
      this.createReason(
        input.code,
        `${input.label} ${input.actual} is below the required minimum of ${input.minimum}.`,
        this.calculateMinimumThresholdSeverity(input.actual, input.minimum),
      ),
    );
  }

  /**
   * Appends a reason when a complexity metric exceeds a configured maximum.
   *
   * @param input Maximum-threshold evaluation parameters.
   */
  private pushMaximumViolationReason(input: {
    readonly reasons: AnalysisDecisionReason[];
    readonly actual: number;
    readonly maximum: number;
    readonly code: AnalysisDecisionReasonCode;
    readonly label: string;
  }): void {
    if (input.actual <= input.maximum) {
      return;
    }

    input.reasons.push(
      this.createReason(
        input.code,
        `${input.label} ${input.actual} exceeds the accepted maximum of ${input.maximum}.`,
        this.calculateMaximumThresholdSeverity(input.actual, input.maximum),
      ),
    );
  }

  /**
   * Calculates the overall suitability of the rule-based NLP result.
   *
   * Quality metrics contribute positively to the score, while text
   * complexity contributes through its inverse value because lower
   * complexity makes the rule-based analysis more suitable.
   *
   * @param input Decision input.
   * @returns Normalized rule-based suitability score between 0 and 1.
   */
  private calculateRuleBasedSuitabilityScore(
    input: AnalysisDecisionInput,
  ): number {
    const weights = ANALYSIS_DECISION_THRESHOLDS.suitabilityWeights;

    const inverseComplexity = 1 - input.complexityMetrics.complexityScore;

    const score =
      input.qualityMetrics.confidence * weights.confidence +
      input.qualityMetrics.resultDensity * weights.resultDensity +
      input.qualityMetrics.evidenceCoverage * weights.evidenceCoverage +
      input.qualityMetrics.dataRetentionRate * weights.dataRetentionRate +
      input.qualityMetrics.lexicalCoverage * weights.lexicalCoverage +
      inverseComplexity * weights.inverseComplexity;

    return this.round(this.clamp(score));
  }

  /**
   * Calculates severity when a value is below a required minimum.
   *
   * @param actual Actual metric value.
   * @param minimum Required minimum value.
   * @returns Normalized severity between 0 and 1.
   */
  private calculateMinimumThresholdSeverity(
    actual: number,
    minimum: number,
  ): number {
    if (minimum <= 0) {
      return 0;
    }

    return this.round(this.clamp((minimum - actual) / minimum));
  }

  /**
   * Calculates severity when a value exceeds an accepted maximum.
   *
   * @param actual Actual metric value.
   * @param maximum Accepted maximum value.
   * @returns Normalized severity between 0 and 1.
   */
  private calculateMaximumThresholdSeverity(
    actual: number,
    maximum: number,
  ): number {
    if (maximum >= 1) {
      return 0;
    }

    return this.round(this.clamp((actual - maximum) / (1 - maximum)));
  }

  /**
   * Creates a normalized explainable decision reason.
   *
   * @param code Stable machine-readable reason code.
   * @param message Human-readable decision explanation.
   * @param weight Relative reason severity.
   * @returns Decision reason.
   */
  private createReason(
    code: AnalysisDecisionReasonCode,
    message: string,
    weight: number,
  ): AnalysisDecisionReason {
    return {
      code,
      message,
      weight: this.round(this.clamp(weight)),
    };
  }

  /**
   * Validates all decision input values before evaluation.
   *
   * @param input Decision input.
   * @throws BadRequestException when the dataset count or metric values are invalid.
   */
  private validateInput(input: AnalysisDecisionInput): void {
    this.validateAnalyzedTextCount(input.totalAnalyzedTexts);
    this.validateNormalizedMetrics(input);
    this.validateAverageTextLength(input.complexityMetrics.averageTextLength);
  }

  /**
   * Validates the analyzed text count.
   *
   * @param totalAnalyzedTexts Number of analyzed texts.
   * @throws BadRequestException when the count is not a finite non-negative integer.
   */
  private validateAnalyzedTextCount(totalAnalyzedTexts: number): void {
    if (
      !Number.isFinite(totalAnalyzedTexts) ||
      !Number.isInteger(totalAnalyzedTexts) ||
      totalAnalyzedTexts < 0
    ) {
      throw new BadRequestException(
        'Total analyzed texts must be a finite non-negative integer.',
      );
    }
  }

  /**
   * Validates all normalized quality and complexity metrics.
   *
   * @param input Decision input.
   * @throws BadRequestException when any normalized metric falls outside the range 0 to 1.
   */
  private validateNormalizedMetrics(input: AnalysisDecisionInput): void {
    const normalizedMetrics = [
      input.qualityMetrics.confidence,
      input.qualityMetrics.resultDensity,
      input.qualityMetrics.evidenceCoverage,
      input.qualityMetrics.dataRetentionRate,
      input.qualityMetrics.lexicalCoverage,
      input.complexityMetrics.negationRatio,
      input.complexityMetrics.contrastRatio,
      input.complexityMetrics.mixedSentimentRatio,
      input.complexityMetrics.lowConfidenceRatio,
      input.complexityMetrics.multiTopicRatio,
      input.complexityMetrics.unmatchedLexiconRatio,
      input.complexityMetrics.complexityScore,
    ];

    const hasInvalidNormalizedMetric = normalizedMetrics.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    );

    if (hasInvalidNormalizedMetric) {
      throw new BadRequestException(
        'Decision metrics must be finite numbers between 0 and 1.',
      );
    }
  }

  /**
   * Validates the raw average text length.
   *
   * @param averageTextLength Average analyzed word count.
   * @throws BadRequestException when the value is negative or non-finite.
   */
  private validateAverageTextLength(averageTextLength: number): void {
    if (!Number.isFinite(averageTextLength) || averageTextLength < 0) {
      throw new BadRequestException(
        'Average text length must be a finite non-negative number.',
      );
    }
  }

  /**
   * Restricts a numeric value to the normalized range from 0 to 1.
   *
   * @param value Value to normalize.
   * @returns Value clamped between 0 and 1.
   */
  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Rounds a numeric value to three decimal places.
   *
   * @param value Value to round.
   * @returns Value rounded to three decimal places.
   */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}
