import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

/**
 * Sentiment scoring result calculated from lexicon-based NLP signals.
 */
export type SentimentScore = {
  /**
   * Positive signal score.
   */
  positiveScore: number;

  /**
   * Negative signal score.
   */
  negativeScore: number;

  /**
   * Absolute score difference used to determine sentiment strength.
   */
  difference: number;

  /**
   * Total score from all sentiment-related signals.
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
 * - Provide the minimum score difference required to classify sentiment.
 * - Keep rule-based scoring configurable and easy to tune.
 *
 * This service does not mutate text analysis records, persist results, or call
 * external AI services.
 *
 * @author Eman
 */
@Injectable()
export class SentimentScoringPolicyService {
  private readonly minimumSentimentDifference = 1;

  private readonly positiveWeights: Partial<Record<NlpLexiconType, number>> = {
    [NlpLexiconType.POSITIVE]: 2,
    [NlpLexiconType.OPPORTUNITY]: 1,
  };

  private readonly negativeWeights: Partial<Record<NlpLexiconType, number>> = {
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
   * Calculates positive and negative sentiment scores for one analyzed text.
   *
   * @param text Lexicon-enriched text analysis record.
   * @returns Sentiment score summary.
   */
  score(text: LexiconTextAnalysisResult): SentimentScore {
    const positiveScore = this.calculateWeightedScore(
      text,
      this.positiveWeights,
    );
    const negativeScore = this.calculateWeightedScore(
      text,
      this.negativeWeights,
    );

    return {
      positiveScore,
      negativeScore,
      difference: positiveScore - negativeScore,
      totalScore: positiveScore + negativeScore,
    };
  }

  /**
   * Returns the minimum score difference required to classify sentiment as
   * positive or negative.
   *
   * @returns Minimum score difference.
   */
  getMinimumSentimentDifference(): number {
    return this.minimumSentimentDifference;
  }

  /**
   * Calculates a weighted score for a set of lexicon types.
   *
   * @param text Lexicon-enriched text analysis record.
   * @param weights Lexicon weights.
   * @returns Weighted score.
   */
  private calculateWeightedScore(
    text: LexiconTextAnalysisResult,
    weights: Partial<Record<NlpLexiconType, number>>,
  ): number {
    return Object.entries(weights).reduce((total, [type, weight]) => {
      const matches = text.matchedLexicons[type as NlpLexiconType]?.length ?? 0;

      return total + matches * (weight ?? 0);
    }, 0);
  }
}
