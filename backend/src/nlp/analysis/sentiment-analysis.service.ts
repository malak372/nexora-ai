import { Injectable } from '@nestjs/common';

import { Sentiment } from '../common/enums/sentiment.enum';
import { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import {
    SentimentScore,
    SentimentScoringPolicyService,
} from './sentiment-scoring-policy.service';

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
 * - Return enriched text analysis records for downstream NLP stages.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class SentimentAnalysisService {
    constructor(
        private readonly sentimentScoringPolicyService: SentimentScoringPolicyService,
    ) { }

    /**
     * Refines sentiment for all lexicon-analyzed texts.
     *
     * @param analyzedTexts Lexicon-enriched text analysis records.
     * @returns Text analysis records with refined sentiment labels.
     */
    analyze(
        analyzedTexts: LexiconTextAnalysisResult[],
    ): LexiconTextAnalysisResult[] {
        return analyzedTexts.map((text) => this.analyzeText(text));
    }

    /**
     * Refines sentiment for one analyzed text.
     *
     * @param text Lexicon-enriched text analysis record.
     * @returns Text analysis record with refined sentiment and confidence.
     */
    private analyzeText(
        text: LexiconTextAnalysisResult,
    ): LexiconTextAnalysisResult {
        const score = this.sentimentScoringPolicyService.score(text);
        const sentiment = this.resolveSentiment(score);
        const confidence = this.calculateConfidence(text.confidence, score);

        return {
            ...text,
            sentiment,
            confidence,
        };
    }

    /**
     * Resolves a final sentiment label from a sentiment score.
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
     * Calculates updated confidence after sentiment refinement.
     *
     * @param baseConfidence Confidence calculated by lexicon analysis.
     * @param score Sentiment score summary.
     * @returns Updated confidence score between 0 and 1.
     */
    private calculateConfidence(
        baseConfidence: number,
        score: SentimentScore,
    ): number {
        if (score.totalScore === 0) {
            return Number(baseConfidence.toFixed(3));
        }

        const sentimentStrength = Math.min(
            Math.abs(score.difference) / score.totalScore,
            1,
        );

        const confidence = baseConfidence * 0.6 + sentimentStrength * 0.4;

        return Number(Math.min(confidence, 1).toFixed(3));
    }
}