import { Injectable } from '@nestjs/common';

import {
  COMPLEX_TEXT_WORD_TARGET,
  CONTRAST_SIGNALS,
  LOW_TEXT_CONFIDENCE_THRESHOLD,
  MULTI_TOPIC_MINIMUM_COUNT,
  NEGATION_SIGNALS,
  TEXT_COMPLEXITY_WEIGHTS,
} from './constants/text-complexity.constants';
import { TextComplexityAnalysisInput } from './types/text-complexity-analysis-input.type';
import { TextComplexityMetrics } from './types/text-complexity-metrics.type';

/**
 * Evaluates linguistic and analytical complexity across community texts.
 *
 * This service identifies signals that may reduce the reliability of the
 * rule-based NLP engine, including:
 * - Long or information-dense texts.
 * - Negation expressions.
 * - Contrastive language.
 * - Mixed sentiment signals.
 * - Low-confidence text analysis.
 * - Multiple topics within the same text.
 * - Missing lexicon coverage.
 *
 * The resulting metrics are consumed by AnalysisDecisionService together
 * with rule-based quality metrics to determine whether:
 * - Rule-based analysis is sufficient.
 * - AI enhancement is required.
 * - The available dataset is insufficient.
 *
 * This service does not:
 * - Call an AI provider.
 * - Persist analysis results.
 * - Modify the rule-based output.
 * - Make the final AI-enhancement decision.
 *
 * All ratios and the final complexity score are normalized between 0 and 1.
 * The average text length is returned as the actual average word count.
 *
 * @author Eman
 */
@Injectable()
export class TextComplexityAnalysisService {
  /**
   * Calculates all text-complexity metrics for the analyzed dataset.
   *
   * @param input Detailed analyzed texts and aggregate topics produced
   * by the rule-based NLP pipeline.
   *
   * @returns Text-complexity metrics used by the decision layer.
   *
   * @throws Error when confidence values or topic frequencies are invalid.
   */
  analyze(input: TextComplexityAnalysisInput): TextComplexityMetrics {
    this.validateInput(input);

    if (input.analyzedTexts.length === 0) {
      return this.createEmptyMetrics();
    }

    const averageTextLength = this.calculateAverageTextLength(input);

    const normalizedTextLength =
      this.normalizeAverageTextLength(averageTextLength);

    const negationRatio = this.calculateSignalRatio(input, NEGATION_SIGNALS);

    const contrastRatio = this.calculateSignalRatio(input, CONTRAST_SIGNALS);

    const mixedSentimentRatio = this.calculateMixedSentimentRatio(input);

    const lowConfidenceRatio = this.calculateLowConfidenceRatio(input);

    const multiTopicRatio = this.calculateMultiTopicRatio(input);

    const unmatchedLexiconRatio = this.calculateUnmatchedLexiconRatio(input);

    const complexityScore = this.calculateComplexityScore({
      normalizedTextLength,
      negationRatio,
      contrastRatio,
      mixedSentimentRatio,
      lowConfidenceRatio,
      multiTopicRatio,
      unmatchedLexiconRatio,
    });

    return {
      averageTextLength,
      negationRatio,
      contrastRatio,
      mixedSentimentRatio,
      lowConfidenceRatio,
      multiTopicRatio,
      unmatchedLexiconRatio,
      complexityScore,
    };
  }

  /**
   * Calculates the average number of normalized words across
   * all analyzed texts.
   *
   * Cleaned text is used because it represents the content that
   * actually entered the rule-based NLP analysis.
   *
   * @param input Text-complexity analysis input.
   * @returns Average word count per analyzed text.
   */
  private calculateAverageTextLength(
    input: TextComplexityAnalysisInput,
  ): number {
    const totalWords = input.analyzedTexts.reduce(
      (sum, text) => sum + this.tokenize(text.cleanedText).length,
      0,
    );

    return this.round(totalWords / input.analyzedTexts.length);
  }

  /**
   * Converts the raw average word count into a normalized complexity
   * component between 0 and 1.
   *
   * @param averageTextLength Average number of words per text.
   * @returns Normalized text-length complexity score.
   */
  private normalizeAverageTextLength(averageTextLength: number): number {
    return this.round(this.clamp(averageTextLength / COMPLEX_TEXT_WORD_TARGET));
  }

  /**
   * Calculates the ratio of analyzed texts containing at least one
   * configured linguistic signal.
   *
   * Token-sequence matching is used instead of substring matching to
   * reduce false positives.
   *
   * @param input Text-complexity analysis input.
   * @param signals Single-word or multi-word expressions to detect.
   * @returns Ratio of matching texts between 0 and 1.
   */
  private calculateSignalRatio(
    input: TextComplexityAnalysisInput,
    signals: readonly (readonly string[])[],
  ): number {
    const matchingTexts = input.analyzedTexts.filter((text) => {
      const tokens = this.tokenize(text.cleanedText);

      return signals.some((signal) =>
        this.containsTokenSequence(tokens, signal),
      );
    }).length;

    return this.calculateRatio(matchingTexts, input.analyzedTexts.length);
  }

  /**
   * Calculates the ratio of texts that contain both positive and
   * negative lexicon signals.
   *
   * Such texts may contain mixed, conditional, or context-dependent
   * sentiment that is difficult to represent using one sentiment label.
   *
   * @param input Text-complexity analysis input.
   * @returns Mixed-sentiment ratio between 0 and 1.
   */
  private calculateMixedSentimentRatio(
    input: TextComplexityAnalysisInput,
  ): number {
    const mixedTexts = input.analyzedTexts.filter((text) => {
      const entries = Object.entries(text.matchedLexicons);

      const hasPositiveSignal = entries.some(
        ([type, matches]) =>
          type === 'POSITIVE' && this.hasMeaningfulMatches(matches),
      );

      const hasNegativeSignal = entries.some(
        ([type, matches]) =>
          type === 'NEGATIVE' && this.hasMeaningfulMatches(matches),
      );

      return hasPositiveSignal && hasNegativeSignal;
    }).length;

    return this.calculateRatio(mixedTexts, input.analyzedTexts.length);
  }

  /**
   * Calculates the ratio of texts whose confidence falls below
   * the configured rule-based confidence threshold.
   *
   * @param input Text-complexity analysis input.
   * @returns Low-confidence ratio between 0 and 1.
   */
  private calculateLowConfidenceRatio(
    input: TextComplexityAnalysisInput,
  ): number {
    const lowConfidenceTexts = input.analyzedTexts.filter(
      (text) => text.confidence < LOW_TEXT_CONFIDENCE_THRESHOLD,
    ).length;

    return this.calculateRatio(lowConfidenceTexts, input.analyzedTexts.length);
  }

  /**
   * Estimates how frequently individual texts contain multiple
   * extracted topic labels.
   *
   * A topic is associated with a text when its normalized token
   * sequence appears in the text.
   *
   * @param input Text-complexity analysis input.
   * @returns Multi-topic ratio between 0 and 1.
   */
  private calculateMultiTopicRatio(input: TextComplexityAnalysisInput): number {
    const normalizedTopics = input.topics
      .map((topic) => this.tokenize(topic.topic))
      .filter((tokens) => tokens.length > 0);

    if (normalizedTopics.length < MULTI_TOPIC_MINIMUM_COUNT) {
      return 0;
    }

    const multiTopicTexts = input.analyzedTexts.filter((text) => {
      const textTokens = this.tokenize(text.cleanedText);

      const matchedTopicCount = normalizedTopics.reduce(
        (count, topicTokens) =>
          this.containsTokenSequence(textTokens, topicTokens)
            ? count + 1
            : count,
        0,
      );

      return matchedTopicCount >= MULTI_TOPIC_MINIMUM_COUNT;
    }).length;

    return this.calculateRatio(multiTopicTexts, input.analyzedTexts.length);
  }

  /**
   * Calculates the ratio of texts that contain no meaningful
   * lexicon matches.
   *
   * A high unmatched ratio may indicate:
   * - Missing domain vocabulary.
   * - Unfamiliar expressions.
   * - Multilingual variation.
   * - Text complexity beyond the current rule-based lexicons.
   *
   * @param input Text-complexity analysis input.
   * @returns Unmatched-lexicon ratio between 0 and 1.
   */
  private calculateUnmatchedLexiconRatio(
    input: TextComplexityAnalysisInput,
  ): number {
    const unmatchedTexts = input.analyzedTexts.filter(
      (text) =>
        !Object.values(text.matchedLexicons).some((matches) =>
          this.hasMeaningfulMatches(matches),
        ),
    ).length;

    return this.calculateRatio(unmatchedTexts, input.analyzedTexts.length);
  }

  /**
   * Calculates the final weighted complexity score.
   *
   * Higher values indicate a stronger likelihood that AI enhancement
   * may be needed.
   *
   * @param input Normalized complexity components.
   * @returns Final complexity score between 0 and 1.
   */
  private calculateComplexityScore(input: {
    readonly normalizedTextLength: number;
    readonly negationRatio: number;
    readonly contrastRatio: number;
    readonly mixedSentimentRatio: number;
    readonly lowConfidenceRatio: number;
    readonly multiTopicRatio: number;
    readonly unmatchedLexiconRatio: number;
  }): number {
    const complexityScore =
      input.normalizedTextLength * TEXT_COMPLEXITY_WEIGHTS.averageTextLength +
      input.negationRatio * TEXT_COMPLEXITY_WEIGHTS.negationRatio +
      input.contrastRatio * TEXT_COMPLEXITY_WEIGHTS.contrastRatio +
      input.mixedSentimentRatio * TEXT_COMPLEXITY_WEIGHTS.mixedSentimentRatio +
      input.lowConfidenceRatio * TEXT_COMPLEXITY_WEIGHTS.lowConfidenceRatio +
      input.multiTopicRatio * TEXT_COMPLEXITY_WEIGHTS.multiTopicRatio +
      input.unmatchedLexiconRatio *
        TEXT_COMPLEXITY_WEIGHTS.unmatchedLexiconRatio;

    return this.round(this.clamp(complexityScore));
  }

  /**
   * Determines whether a lexicon-match collection contains at least
   * one meaningful non-empty value.
   *
   * @param matches Optional matched lexicon values.
   * @returns True when at least one valid match exists.
   */
  private hasMeaningfulMatches(
    matches: readonly string[] | undefined,
  ): boolean {
    return matches?.some((match) => match.trim().length > 0) ?? false;
  }

  /**
   * Determines whether a token collection contains a complete
   * single-word or multi-word signal sequence.
   *
   * @param tokens Tokens extracted from an analyzed text.
   * @param signalTokens Tokens representing the searched expression.
   * @returns True when the complete expression exists in the text.
   */
  private containsTokenSequence(
    tokens: readonly string[],
    signalTokens: readonly string[],
  ): boolean {
    if (signalTokens.length === 0 || signalTokens.length > tokens.length) {
      return false;
    }

    const maximumStartIndex = tokens.length - signalTokens.length;

    for (let startIndex = 0; startIndex <= maximumStartIndex; startIndex += 1) {
      const matches = signalTokens.every(
        (signalToken, signalIndex) =>
          tokens[startIndex + signalIndex] === signalToken,
      );

      if (matches) {
        return true;
      }
    }

    return false;
  }

  /**
   * Converts a text into normalized Unicode word tokens.
   *
   * This supports Arabic and the Latin-script languages configured
   * in Nexora AI without relying on whitespace alone.
   *
   * @param text Text to tokenize.
   * @returns Lowercase Unicode word tokens.
   */
  private tokenize(text: string): string[] {
    return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  }

  /**
   * Calculates a normalized ratio while safely handling an empty
   * denominator.
   *
   * @param numerator Number of matching texts.
   * @param denominator Total number of analyzed texts.
   * @returns Normalized ratio between 0 and 1.
   */
  private calculateRatio(numerator: number, denominator: number): number {
    if (denominator === 0) {
      return 0;
    }

    return this.round(this.clamp(numerator / denominator));
  }

  /**
   * Validates text-complexity input before calculation.
   *
   * Validation prevents:
   * - Invalid confidence scores.
   * - Negative or decimal topic frequencies.
   * - Non-finite numeric values.
   *
   * @param input Text-complexity analysis input.
   * @throws Error when input values are invalid.
   */
  private validateInput(input: TextComplexityAnalysisInput): void {
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

    const hasInvalidTopicFrequency = input.topics.some(
      (topic) =>
        !Number.isFinite(topic.frequency) ||
        !Number.isInteger(topic.frequency) ||
        topic.frequency < 0,
    );

    if (hasInvalidTopicFrequency) {
      throw new Error(
        'Topic frequencies must be finite non-negative integers.',
      );
    }
  }

  /**
   * Creates a zero-valued metrics object when the dataset contains
   * no analyzed texts.
   *
   * The decision layer will later classify this state as insufficient
   * data based on the dataset size.
   *
   * @returns Empty text-complexity metrics.
   */
  private createEmptyMetrics(): TextComplexityMetrics {
    return {
      averageTextLength: 0,
      negationRatio: 0,
      contrastRatio: 0,
      mixedSentimentRatio: 0,
      lowConfidenceRatio: 0,
      multiTopicRatio: 0,
      unmatchedLexiconRatio: 0,
      complexityScore: 0,
    };
  }

  /**
   * Restricts a number to the normalized range from 0 to 1.
   *
   * @param value Value to normalize.
   * @returns Value clamped between 0 and 1.
   */
  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Rounds a numeric result to three decimal places.
   *
   * @param value Value to round.
   * @returns Value rounded to three decimal places.
   */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}
