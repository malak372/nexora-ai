import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import {
    SentimentLabel,
    TextAnalysisResult,
} from './types/intelligent-analysis.types';

/**
 * Builds statistical summaries for intelligent NLP analysis results.
 *
 * This service centralizes aggregate calculations such as sentiment
 * distribution, dominant language, and overall confidence so the main
 * IntelligentAnalysisService remains a clean pipeline orchestrator.
 *
 * Responsibilities:
 * - Count analyzed posts and comments.
 * - Calculate sentiment distribution.
 * - Detect dominant sentiment.
 * - Detect dominant language.
 * - Calculate overall confidence.
 *
 * This service does not persist results and does not call external AI services.
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
    buildSentimentStats(analyzedTexts: TextAnalysisResult[]): {
        positive: number;
        negative: number;
        neutral: number;
        dominantSentiment: SentimentLabel;
    } {
        const positive = analyzedTexts.filter(
            (text) => text.sentiment === Sentiment.POSITIVE,
        ).length;

        const negative = analyzedTexts.filter(
            (text) => text.sentiment === Sentiment.NEGATIVE,
        ).length;

        const neutral = analyzedTexts.filter(
            (text) => text.sentiment === Sentiment.NEUTRAL,
        ).length;

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
    countPosts(analyzedTexts: TextAnalysisResult[]): number {
        return analyzedTexts.filter((text) => text.sourceType === 'POST').length;
    }

    /**
     * Counts analyzed comments.
     *
     * @param analyzedTexts Final analyzed text records.
     * @returns Number of analyzed comments.
     */
    countComments(analyzedTexts: TextAnalysisResult[]): number {
        return analyzedTexts.filter((text) => text.sourceType === 'COMMENT').length;
    }

    /**
     * Detects the dominant language in analyzed texts.
     *
     * @param analyzedTexts Final analyzed text records.
     * @returns Dominant language code.
     */
    detectDominantLanguage(analyzedTexts: TextAnalysisResult[]): LanguageCode {
        const languageCounts = new Map<LanguageCode, number>();

        for (const text of analyzedTexts) {
            languageCounts.set(
                text.language,
                (languageCounts.get(text.language) ?? 0) + 1,
            );
        }

        return (
            [...languageCounts.entries()].sort(
                (first, second) => second[1] - first[1],
            )[0]?.[0] ?? LanguageCode.ANY
        );
    }

    /**
     * Calculates the average confidence across all analyzed texts.
     *
     * @param analyzedTexts Final analyzed text records.
     * @returns Overall confidence score between 0 and 1.
     */
    calculateOverallConfidence(analyzedTexts: TextAnalysisResult[]): number {
        if (analyzedTexts.length === 0) {
            return 0;
        }

        const totalConfidence = analyzedTexts.reduce(
            (total, text) => total + text.confidence,
            0,
        );

        return Number((totalConfidence / analyzedTexts.length).toFixed(3));
    }

    /**
     * Detects the dominant sentiment from sentiment counters.
     *
     * @param stats Sentiment counters.
     * @returns Dominant sentiment label.
     */
    private detectDominantSentiment(stats: {
        positive: number;
        negative: number;
        neutral: number;
    }): SentimentLabel {
        if (stats.negative >= stats.positive && stats.negative >= stats.neutral) {
            return Sentiment.NEGATIVE;
        }

        if (stats.positive >= stats.negative && stats.positive >= stats.neutral) {
            return Sentiment.POSITIVE;
        }

        return Sentiment.NEUTRAL;
    }
}