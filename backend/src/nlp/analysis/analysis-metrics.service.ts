import { Injectable } from '@nestjs/common';

import { AnalysisQualityMetrics } from '../decision/types/analysis-quality-metrics.type';
import {
  ANALYSIS_CONFIDENCE_WEIGHTS,
  TARGET_RESULTS_PER_TEXT,
} from './constants/analysis-metrics.constants';
import { AnalysisMetricsInput } from './types/analysis-metrics-input.type';

/**
 * Calculates normalized quality metrics for the rule-based NLP analysis.
 *
 * This service evaluates the strength, coverage, and reliability of the
 * current rule-based output before the decision layer determines whether
 * AI enhancement is required.
 *
 * Responsibilities:
 * - Calculate result density.
 * - Calculate evidence coverage.
 * - Calculate data retention rate.
 * - Calculate lexical coverage.
 * - Calculate the overall rule-based confidence.
 *
 * The service does not:
 * - Call external AI providers.
 * - Persist analysis results.
 * - Decide whether AI enhancement is required.
 * - Modify the original analysis output.
 *
 * All returned metrics are normalized between 0 and 1 and rounded
 * to three decimal places.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisMetricsService {
  /**
   * Calculates all quality metrics from the current rule-based
   * intelligent analysis output.
   *
   * @param input Rule-based NLP output fields required for quality evaluation.
   *
   * @returns Normalized analysis quality metrics containing:
   * - Overall confidence.
   * - Result density.
   * - Evidence coverage.
   * - Data retention rate.
   * - Lexical coverage.
   *
   * @throws Error when the supplied analysis data is invalid or inconsistent.
   */
  calculate(input: AnalysisMetricsInput): AnalysisQualityMetrics {
    this.validateInput(input);

    const totalCollectedTexts = this.calculateTotalCollectedTexts(input);

    const extractedResultsCount = this.calculateExtractedResultsCount(input);

    const evidenceEligibleResultsCount =
      this.calculateEvidenceEligibleResultsCount(input);

    const evidenceBackedResultsCount =
      this.calculateEvidenceBackedResultsCount(input);

    const textsWithLexiconMatches =
      this.calculateTextsWithLexiconMatches(input);

    const averageTextConfidence = this.calculateAverageTextConfidence(input);

    const resultDensity = this.calculateResultDensity(
      extractedResultsCount,
      input.totalTextsAnalyzed,
    );

    const evidenceCoverage = this.calculateEvidenceCoverage(
      evidenceBackedResultsCount,
      evidenceEligibleResultsCount,
    );

    const dataRetentionRate = this.calculateDataRetentionRate(
      input.totalTextsAnalyzed,
      totalCollectedTexts,
    );

    const lexicalCoverage = this.calculateLexicalCoverage(
      textsWithLexiconMatches,
      input.totalTextsAnalyzed,
    );

    const confidence = this.calculateOverallConfidence({
      averageTextConfidence,
      resultDensity,
      evidenceCoverage,
      dataRetentionRate,
      lexicalCoverage,
    });

    return {
      confidence,
      resultDensity,
      evidenceCoverage,
      dataRetentionRate,
      lexicalCoverage,
    };
  }

  /**
   * Reconstructs the total number of collected texts before preprocessing.
   *
   * The total consists of:
   * - Retained and analyzed texts.
   * - Removed duplicate texts.
   * - Removed spam or low-quality texts.
   * - Removed domain-irrelevant texts.
   *
   * @param input Analysis metrics input.
   * @returns Total number of collected texts before filtering.
   */
  private calculateTotalCollectedTexts(input: AnalysisMetricsInput): number {
    return (
      input.totalTextsAnalyzed +
      input.dataQuality.duplicateTextsRemoved +
      input.dataQuality.spamTextsRemoved +
      input.dataQuality.irrelevantTextsRemoved
    );
  }

  /**
   * Counts all meaningful aggregated results extracted by the
   * rule-based NLP pipeline.
   *
   * Included result categories:
   * - Keywords.
   * - Topics.
   * - Recurring problems.
   * - Extracted needs.
   * - Feature requests.
   * - Opportunities.
   *
   * @param input Analysis metrics input.
   * @returns Total extracted result count.
   */
  private calculateExtractedResultsCount(input: AnalysisMetricsInput): number {
    return (
      input.keywords.length +
      input.topics.length +
      input.recurringProblems.length +
      input.extractedNeeds.length +
      input.featureRequests.length +
      input.opportunities.length
    );
  }

  /**
   * Counts results for which supporting evidence is expected.
   *
   * Keywords and topics are excluded because they are frequency-based
   * aggregate results and do not necessarily require direct evidence samples.
   *
   * @param input Analysis metrics input.
   * @returns Total number of evidence-eligible results.
   */
  private calculateEvidenceEligibleResultsCount(
    input: AnalysisMetricsInput,
  ): number {
    return (
      input.recurringProblems.length +
      input.extractedNeeds.length +
      input.featureRequests.length +
      input.opportunities.length
    );
  }

  /**
   * Counts evidence-eligible results that contain at least one
   * meaningful supporting evidence sample.
   *
   * @param input Analysis metrics input.
   * @returns Total number of evidence-backed results.
   */
  private calculateEvidenceBackedResultsCount(
    input: AnalysisMetricsInput,
  ): number {
    const recurringProblemsWithEvidence = input.recurringProblems.filter(
      (problem) => this.hasEvidence(problem.evidenceSamples),
    ).length;

    const extractedNeedsWithEvidence = input.extractedNeeds.filter((need) =>
      this.hasEvidence(need.evidenceSamples),
    ).length;

    const featureRequestsWithEvidence = input.featureRequests.filter(
      (request) => this.hasEvidence(request.evidenceSamples),
    ).length;

    const opportunitiesWithEvidence = input.opportunities.filter(
      (opportunity) => this.hasEvidence(opportunity.evidenceSamples),
    ).length;

    return (
      recurringProblemsWithEvidence +
      extractedNeedsWithEvidence +
      featureRequestsWithEvidence +
      opportunitiesWithEvidence
    );
  }

  /**
   * Counts analyzed texts containing at least one matched lexicon term.
   *
   * @param input Analysis metrics input.
   * @returns Number of texts containing one or more lexicon matches.
   */
  private calculateTextsWithLexiconMatches(
    input: AnalysisMetricsInput,
  ): number {
    return input.analyzedTexts.filter((text) =>
      this.hasLexiconMatches(text.matchedLexicons),
    ).length;
  }

  /**
   * Calculates the average confidence across all analyzed texts.
   *
   * @param input Analysis metrics input.
   * @returns Average text-level confidence between 0 and 1.
   */
  private calculateAverageTextConfidence(input: AnalysisMetricsInput): number {
    if (input.analyzedTexts.length === 0) {
      return 0;
    }

    const totalConfidence = input.analyzedTexts.reduce(
      (sum, text) => sum + this.clamp(text.confidence),
      0,
    );

    return this.round(totalConfidence / input.analyzedTexts.length);
  }

  /**
   * Measures the number of extracted results relative to the configured
   * expected number of results per analyzed text.
   *
   * @param extractedResultsCount Total number of extracted results.
   * @param totalAnalyzedTexts Total number of analyzed texts.
   *
   * @returns Normalized result-density score between 0 and 1.
   */
  private calculateResultDensity(
    extractedResultsCount: number,
    totalAnalyzedTexts: number,
  ): number {
    if (totalAnalyzedTexts === 0) {
      return 0;
    }

    const targetResultsCount = totalAnalyzedTexts * TARGET_RESULTS_PER_TEXT;

    return this.round(this.clamp(extractedResultsCount / targetResultsCount));
  }

  /**
   * Measures the percentage of evidence-eligible results that contain
   * supporting evidence.
   *
   * @param evidenceBackedResultsCount Number of evidence-backed results.
   * @param evidenceEligibleResultsCount Number of evidence-eligible results.
   *
   * @returns Normalized evidence-coverage score between 0 and 1.
   */
  private calculateEvidenceCoverage(
    evidenceBackedResultsCount: number,
    evidenceEligibleResultsCount: number,
  ): number {
    if (evidenceEligibleResultsCount === 0) {
      return 0;
    }

    return this.round(
      this.clamp(evidenceBackedResultsCount / evidenceEligibleResultsCount),
    );
  }

  /**
   * Measures how much of the collected dataset remained usable after:
   * - Text cleaning.
   * - Duplicate removal.
   * - Spam filtering.
   * - Domain relevance filtering.
   *
   * @param totalAnalyzedTexts Number of retained analyzed texts.
   * @param totalCollectedTexts Total number of originally collected texts.
   *
   * @returns Normalized data-retention score between 0 and 1.
   */
  private calculateDataRetentionRate(
    totalAnalyzedTexts: number,
    totalCollectedTexts: number,
  ): number {
    if (totalCollectedTexts === 0) {
      return 0;
    }

    return this.round(this.clamp(totalAnalyzedTexts / totalCollectedTexts));
  }

  /**
   * Measures the percentage of analyzed texts containing at least
   * one matched lexicon signal.
   *
   * A low lexical-coverage score may indicate:
   * - Insufficient lexicon coverage for the selected domain.
   * - Unfamiliar wording or expressions.
   * - Multilingual or mixed-language content.
   * - Text complexity that may require AI enhancement.
   *
   * @param textsWithLexiconMatches Number of texts with lexicon matches.
   * @param totalAnalyzedTexts Total number of analyzed texts.
   *
   * @returns Normalized lexical-coverage score between 0 and 1.
   */
  private calculateLexicalCoverage(
    textsWithLexiconMatches: number,
    totalAnalyzedTexts: number,
  ): number {
    if (totalAnalyzedTexts === 0) {
      return 0;
    }

    return this.round(this.clamp(textsWithLexiconMatches / totalAnalyzedTexts));
  }

  /**
   * Calculates the final rule-based analysis confidence using
   * the configured weighted quality metrics.
   *
   * The calculation combines:
   * - Average text confidence.
   * - Result density.
   * - Evidence coverage.
   * - Data retention rate.
   * - Lexical coverage.
   *
   * @param input Individual normalized quality metrics.
   *
   * @returns Overall confidence score between 0 and 1.
   */
  private calculateOverallConfidence(input: {
    readonly averageTextConfidence: number;
    readonly resultDensity: number;
    readonly evidenceCoverage: number;
    readonly dataRetentionRate: number;
    readonly lexicalCoverage: number;
  }): number {
    const confidence =
      input.averageTextConfidence * ANALYSIS_CONFIDENCE_WEIGHTS.textConfidence +
      input.resultDensity * ANALYSIS_CONFIDENCE_WEIGHTS.resultDensity +
      input.evidenceCoverage * ANALYSIS_CONFIDENCE_WEIGHTS.evidenceCoverage +
      input.dataRetentionRate * ANALYSIS_CONFIDENCE_WEIGHTS.dataRetentionRate +
      input.lexicalCoverage * ANALYSIS_CONFIDENCE_WEIGHTS.lexicalCoverage;

    return this.round(this.clamp(confidence));
  }

  /**
   * Validates that the input is structurally and logically consistent.
   *
   * Validation prevents:
   * - Negative counters.
   * - Decimal counters.
   * - Non-finite counters.
   * - Analyzed text count mismatches.
   * - Confidence values outside the normalized range.
   *
   * @param input Analysis metrics input.
   *
   * @throws Error when counters, confidence values, or analyzed text
   * collections are invalid or inconsistent.
   */
  private validateInput(input: AnalysisMetricsInput): void {
    const counters = [
      input.totalTextsAnalyzed,
      input.dataQuality.duplicateTextsRemoved,
      input.dataQuality.spamTextsRemoved,
      input.dataQuality.irrelevantTextsRemoved,
    ];

    const hasInvalidCounter = counters.some(
      (value) =>
        !Number.isFinite(value) || !Number.isInteger(value) || value < 0,
    );

    if (hasInvalidCounter) {
      throw new Error(
        'Analysis metric counters must be finite non-negative integers.',
      );
    }

    if (input.analyzedTexts.length !== input.totalTextsAnalyzed) {
      throw new Error('Analyzed text count must equal totalTextsAnalyzed.');
    }

    const hasInvalidConfidence = input.analyzedTexts.some(
      (text) =>
        !Number.isFinite(text.confidence) ||
        text.confidence < 0 ||
        text.confidence > 1,
    );

    if (hasInvalidConfidence) {
      throw new Error(
        'Text confidence values must be finite numbers between 0 and 1.',
      );
    }
  }

  /**
   * Determines whether an evidence collection contains at least one
   * meaningful non-empty sample.
   *
   * @param evidenceSamples Evidence samples associated with a result.
   * @returns True when at least one valid evidence sample exists.
   */
  private hasEvidence(evidenceSamples: readonly string[]): boolean {
    return evidenceSamples.some((sample) => sample.trim().length > 0);
  }

  /**
   * Determines whether a text contains at least one matched lexicon term.
   *
   * The parameter type is derived directly from the existing NLP
   * analysis contract to avoid coupling this service to Prisma enums.
   *
   * @param matchedLexicons Lexicon matches grouped by NLP category.
   * @returns True when at least one lexicon group contains a valid match.
   */
  private hasLexiconMatches(
    matchedLexicons: AnalysisMetricsInput['analyzedTexts'][number]['matchedLexicons'],
  ): boolean {
    return Object.values(matchedLexicons).some(
      (matches) =>
        matches !== undefined &&
        matches.some((match) => match.trim().length > 0),
    );
  }

  /**
   * Restricts a numeric value to the normalized range from 0 to 1.
   *
   * @param value Numeric value to normalize.
   * @returns Value clamped between 0 and 1.
   */
  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Rounds a normalized metric to three decimal places.
   *
   * Three-decimal precision matches the confidence precision stored
   * in the database using Decimal(4, 3).
   *
   * @param value Metric value to round.
   * @returns Value rounded to three decimal places.
   */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}
