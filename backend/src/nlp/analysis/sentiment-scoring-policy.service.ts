import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

/**
 * Minimum signed score difference required to classify sentiment
 * as positive or negative.
 */
const MINIMUM_SENTIMENT_DIFFERENCE = 1;

/**
 * Additional score granted for each repeated occurrence of the same
 * lexicon match within one analyzed text.
 *
 * The first occurrence receives the configured lexicon weight.
 * Every additional occurrence receives only this repetition bonus.
 */
const REPETITION_BONUS_PER_OCCURRENCE = 0.25;

/**
 * Maximum repetition bonus allowed for one unique lexicon match
 * within a single analyzed text.
 *
 * This limit prevents one repeated word or phrase from disproportionately
 * inflating the sentiment score.
 */
const MAX_REPETITION_BONUS_PER_MATCH = 1;

/**
 * Lexicon weights that contribute to positive sentiment.
 */
const POSITIVE_SENTIMENT_WEIGHTS: Readonly<
  Partial<Record<NlpLexiconType, number>>
> = {
  [NlpLexiconType.POSITIVE]: 2,
  [NlpLexiconType.OPPORTUNITY]: 1,
};

/**
 * Lexicon weights that contribute to negative sentiment.
 */
const NEGATIVE_SENTIMENT_WEIGHTS: Readonly<
  Partial<Record<NlpLexiconType, number>>
> = {
  [NlpLexiconType.NEGATIVE]: 2,
  [NlpLexiconType.COMPLAINT]: 2,
  [NlpLexiconType.PROBLEM]: 1,
  [NlpLexiconType.URGENCY]: 1,
  [NlpLexiconType.COST]: 1,
  [NlpLexiconType.TIME]: 1,
  [NlpLexiconType.ACCESSIBILITY]: 1,
  [NlpLexiconType.SAFETY]: 1,
  [NlpLexiconType.RELIABILITY]: 1,
};

/**
 * Sentiment scoring result calculated from lexicon-based NLP signals.
 */
export type SentimentScore = {
  /**
   * Weighted score produced by positive sentiment signals.
   */
  positiveScore: number;

  /**
   * Weighted score produced by negative sentiment signals.
   */
  negativeScore: number;

  /**
   * Signed difference between positive and negative scores.
   *
   * A positive value indicates stronger positive sentiment.
   * A negative value indicates stronger negative sentiment.
   */
  difference: number;

  /**
   * Combined score from all positive and negative sentiment signals.
   */
  totalScore: number;
};

/**
 * Provides reusable sentiment scoring rules for the NLP engine.
 *
 * This policy service centralizes sentiment weights and thresholds so the
 * SentimentAnalysisService can focus on applying sentiment decisions instead
 * of owning scoring configuration.
 *
 * Responsibilities:
 * - Assign weights to positive and negative NLP lexicon signals.
 * - Calculate sentiment scores for analyzed texts.
 * - Apply controlled repetition bonuses for repeated signals.
 * - Provide the minimum score difference required to classify sentiment.
 * - Keep rule-based scoring configurable and easy to tune.
 *
 * This service does not:
 * - Modify text-analysis records.
 * - Persist sentiment results.
 * - Call external AI providers.
 *
 * @author Eman
 */
@Injectable()
export class SentimentScoringPolicyService {
  /**
   * Calculates positive and negative sentiment scores for one analyzed text.
   *
   * @param text Lexicon-enriched text-analysis record.
   * @returns Calculated sentiment-score summary.
   */
  score(text: LexiconTextAnalysisResult): SentimentScore {
    const positiveScore = this.calculateWeightedScore(
      text,
      POSITIVE_SENTIMENT_WEIGHTS,
    );

    const negativeScore = this.calculateWeightedScore(
      text,
      NEGATIVE_SENTIMENT_WEIGHTS,
    );

    return {
      positiveScore,
      negativeScore,
      difference: positiveScore - negativeScore,
      totalScore: positiveScore + negativeScore,
    };
  }

  /**
   * Returns the minimum signed score difference required to classify
   * sentiment as positive or negative.
   *
   * @returns Minimum sentiment-score difference.
   */
  getMinimumSentimentDifference(): number {
    return MINIMUM_SENTIMENT_DIFFERENCE;
  }

  /**
   * Calculates a weighted score for configured lexicon types.
   *
   * Each unique normalized lexicon match contributes its configured
   * base weight. Repeated occurrences of the same match contribute only
   * a controlled repetition bonus.
   *
   * Example for a match with weight 2:
   *
   * - One occurrence: 2
   * - Two occurrences: 2.25
   * - Three occurrences: 2.5
   * - Five or more occurrences: 3
   *
   * @param text Lexicon-enriched text-analysis record.
   * @param weights Configured lexicon weights.
   * @returns Total weighted score.
   */
  private calculateWeightedScore(
    text: LexiconTextAnalysisResult,
    weights: Readonly<Partial<Record<NlpLexiconType, number>>>,
  ): number {
    let totalScore = 0;

    for (const lexiconType of Object.values(NlpLexiconType)) {
      const weight = weights[lexiconType];

      if (weight === undefined || weight <= 0) {
        continue;
      }

      const matches = text.matchedLexicons[lexiconType] ?? [];
      const occurrenceCountByMatch = new Map<string, number>();

      for (const match of matches) {
        const normalizedMatch = this.normalizeMatch(match);

        if (!normalizedMatch) {
          continue;
        }

        occurrenceCountByMatch.set(
          normalizedMatch,
          (occurrenceCountByMatch.get(normalizedMatch) ?? 0) + 1,
        );
      }

      for (const occurrenceCount of occurrenceCountByMatch.values()) {
        totalScore += this.calculateMatchScore(
          occurrenceCount,
          weight,
        );
      }
    }

    return totalScore;
  }

  /**
   * Calculates the contribution of one unique lexicon match.
   *
   * The first occurrence receives the full configured weight.
   * Additional occurrences receive a limited repetition bonus.
   *
   * @param occurrenceCount Number of occurrences in one analyzed text.
   * @param weight Configured base lexicon weight.
   * @returns Weighted score for the normalized match.
   */
  private calculateMatchScore(
    occurrenceCount: number,
    weight: number,
  ): number {
    const repeatedOccurrences = Math.max(occurrenceCount - 1, 0);

    const repetitionBonus = Math.min(
      repeatedOccurrences * REPETITION_BONUS_PER_OCCURRENCE,
      MAX_REPETITION_BONUS_PER_MATCH,
    );

    return weight + repetitionBonus;
  }

  /**
   * Normalizes a lexicon match for stable repetition counting.
   *
   * Normalization:
   * - Converts the match to locale-aware lowercase.
   * - Replaces repeated whitespace with one space.
   * - Removes leading and trailing whitespace.
   *
   * @param match Raw matched lexicon term or phrase.
   * @returns Normalized match.
   */
  private normalizeMatch(match: string): string {
    return match
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  }
}