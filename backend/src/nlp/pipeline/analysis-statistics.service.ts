import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';

import type {
  TextAnalysisResult,
} from './types/intelligent-analysis.types';

/**
 * Builds statistical summaries for intelligent NLP analysis results.
 *
 * Responsibilities:
 * - Count analyzed posts and comments.
 * - Calculate sentiment distribution.
 * - Detect dominant sentiment.
 * - Detect dominant language.
 * - Calculate overall confidence.
 *
 * This service does not persist results or call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisStatisticsService {
  /**
   * Calculates sentiment statistics for analyzed texts.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Sentiment distribution and dominant sentiment.
   */
  buildSentimentStats(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): {
    positive: number;
    negative: number;
    neutral: number;
    dominantSentiment: Sentiment;
  } {
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const text of analyzedTexts) {
      switch (text.sentiment) {
        case Sentiment.POSITIVE:
          positive += 1;
          break;

        case Sentiment.NEGATIVE:
          negative += 1;
          break;

        case Sentiment.NEUTRAL:
          neutral += 1;
          break;
      }
    }

    return {
      positive,
      negative,
      neutral,
      dominantSentiment: this.detectDominantSentiment({
        positive,
        negative,
        neutral,
      }),
    };
  }

  /**
   * Counts analyzed posts.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Number of analyzed posts.
   */
  countPosts(analyzedTexts: ReadonlyArray<TextAnalysisResult>): number {
    return analyzedTexts.filter((text) => text.sourceType === 'POST').length;
  }

  /**
   * Counts analyzed comments.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Number of analyzed comments.
   */
  countComments(analyzedTexts: ReadonlyArray<TextAnalysisResult>): number {
    return analyzedTexts.filter(
      (text) => text.sourceType === 'COMMENT',
    ).length;
  }

  /**
   * Detects the dominant language in analyzed texts.
   *
   * ANY is returned only when no analyzed text exists.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Dominant language or ANY for an empty collection.
   */
  detectDominantLanguage(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): LanguageCode {
    const languageCounts = new Map<LanguageCode, number>();

    for (const text of analyzedTexts) {
      languageCounts.set(
        text.language,
        (languageCounts.get(text.language) ?? 0) + 1,
      );
    }

    return (
      [...languageCounts.entries()].sort(
        ([firstLanguage, firstCount], [secondLanguage, secondCount]) =>
          secondCount - firstCount ||
          firstLanguage.localeCompare(secondLanguage),
      )[0]?.[0] ?? LanguageCode.ANY
    );
  }

  /**
   * Calculates average confidence across all analyzed texts.
   *
   * Invalid values are bounded to the valid range from 0 to 1.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Overall confidence score between 0 and 1.
   */
  calculateOverallConfidence(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): number {
    if (analyzedTexts.length === 0) {
      return 0;
    }

    const totalConfidence = analyzedTexts.reduce(
      (total, text) =>
        total + Math.min(1, Math.max(0, text.confidence)),
      0,
    );

    return Number((totalConfidence / analyzedTexts.length).toFixed(3));
  }

  /**
   * Detects the dominant sentiment from sentiment counters.
   *
   * Negative is intentionally prioritized during ties so repeated pain
   * signals are not hidden by an equal number of neutral or positive texts.
   *
   * @param stats Sentiment counters.
   * @returns Dominant sentiment classification.
   */
  private detectDominantSentiment(stats: {
    positive: number;
    negative: number;
    neutral: number;
  }): Sentiment {
    if (stats.negative >= stats.positive && stats.negative >= stats.neutral) {
      return Sentiment.NEGATIVE;
    }

    if (stats.positive >= stats.negative && stats.positive >= stats.neutral) {
      return Sentiment.POSITIVE;
    }

    return Sentiment.NEUTRAL;
  }
}