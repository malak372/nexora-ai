import { Injectable } from '@nestjs/common';

import { Sentiment } from '../common/enums/sentiment.enum';

import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type { SentimentScore } from './sentiment-scoring-policy.service';

import { SentimentScoringPolicyService } from './sentiment-scoring-policy.service';

/**
 * Weight assigned to the confidence produced by lexicon analysis.
 */
const BASE_CONFIDENCE_WEIGHT = 0.6;

/**
 * Weight assigned to the strength of the sentiment result.
 */
const SENTIMENT_STRENGTH_WEIGHT = 0.4;

/**
 * Minimum permitted confidence value.
 */
const MINIMUM_CONFIDENCE = 0;

/**
 * Maximum permitted confidence value.
 */
const MAXIMUM_CONFIDENCE = 1;

/**
 * Number of decimal places retained in confidence values.
 */
const CONFIDENCE_DECIMAL_PLACES = 3;

/**
 * Refines sentiment labels for lexicon-analyzed community texts.
 *
 * This service applies the sentiment scoring policy to improve the initial
 * sentiment produced by LexiconAnalysisService. It considers weighted positive
 * and negative NLP signals while keeping scoring rules separated from the
 * orchestration logic.
 *
 * Responsibilities:
 * - Apply rule-based sentiment scoring to analyzed texts.
 * - Resolve final sentiment labels from positive and negative scores.
 * - Update confidence using sentiment strength.
 * - Return enriched text-analysis records for downstream NLP stages.
 *
 * This service does not:
 * - Persist analysis results.
 * - Call external AI providers.
 * - Modify the supplied analysis records.
 *
 * @author Eman
 */
@Injectable()
export class SentimentAnalysisService {
  constructor(
    private readonly sentimentScoringPolicyService: SentimentScoringPolicyService,
  ) {}

  /**
   * Refines sentiment for all lexicon-analyzed texts.
   *
   * @param analyzedTexts Lexicon-enriched text-analysis records.
   * @returns New text-analysis records with refined sentiment and confidence.
   */
  analyze(
    analyzedTexts: readonly LexiconTextAnalysisResult[],
  ): LexiconTextAnalysisResult[] {
    return analyzedTexts.map((text) => this.analyzeText(text));
  }

  /**
   * Refines sentiment for one analyzed text.
   *
   * @param text Lexicon-enriched text-analysis record.
   * @returns New text-analysis record with refined sentiment and confidence.
   */
  private analyzeText(
    text: LexiconTextAnalysisResult,
  ): LexiconTextAnalysisResult {
    const score = this.sentimentScoringPolicyService.score(text);

    return {
      ...text,
      sentiment: this.resolveSentiment(score),
      confidence: this.calculateConfidence(text.confidence, score),
    };
  }

  /**
   * Resolves a final sentiment label from the calculated sentiment score.
   *
   * @param score Sentiment score summary.
   * @returns Final sentiment label.
   */
  private resolveSentiment(score: SentimentScore): Sentiment {
    const minimumDifference =
      this.sentimentScoringPolicyService.getMinimumSentimentDifference();

    if (score.difference >= minimumDifference) {
      return Sentiment.POSITIVE;
    }

    if (score.difference <= -minimumDifference) {
      return Sentiment.NEGATIVE;
    }

    return Sentiment.NEUTRAL;
  }

  /**
   * Calculates confidence after sentiment refinement.
   *
   * Confidence combines:
   * - The confidence produced by lexicon analysis.
   * - The strength of the calculated sentiment signal.
   *
   * @param baseConfidence Confidence produced by lexicon analysis.
   * @param score Sentiment score summary.
   * @returns Normalized confidence between zero and one.
   */
  private calculateConfidence(
    baseConfidence: number,
    score: SentimentScore,
  ): number {
    const normalizedBaseConfidence = this.normalizeConfidence(baseConfidence);

    if (!Number.isFinite(score.totalScore) || score.totalScore <= 0) {
      return this.roundConfidence(normalizedBaseConfidence);
    }

    const sentimentStrength = this.normalizeConfidence(
      Math.abs(score.difference) / score.totalScore,
    );

    const confidence =
      normalizedBaseConfidence * BASE_CONFIDENCE_WEIGHT +
      sentimentStrength * SENTIMENT_STRENGTH_WEIGHT;

    return this.roundConfidence(this.normalizeConfidence(confidence));
  }

  /**
   * Restricts a confidence value to the supported range.
   *
   * @param confidence Raw confidence value.
   * @returns Confidence between zero and one.
   */
  private normalizeConfidence(confidence: number): number {
    if (!Number.isFinite(confidence)) {
      return MINIMUM_CONFIDENCE;
    }

    return Math.min(
      Math.max(confidence, MINIMUM_CONFIDENCE),
      MAXIMUM_CONFIDENCE,
    );
  }

  /**
   * Rounds confidence to the configured number of decimal places.
   *
   * @param confidence Normalized confidence value.
   * @returns Rounded confidence.
   */
  private roundConfidence(confidence: number): number {
    return Number(confidence.toFixed(CONFIDENCE_DECIMAL_PLACES));
  }
}
