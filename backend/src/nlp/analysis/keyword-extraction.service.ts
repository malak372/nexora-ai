import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { STOP_WORDS } from '../common/constants/stop-words.constant';
import {
    WeightedKeyword,
} from '../pipeline/types/intelligent-analysis.types';
import { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

/**
 * Extracts weighted keywords from lexicon-analyzed community texts.
 *
 * This service identifies the most frequent meaningful terms found in cleaned
 * social posts and comments after preprocessing and lexicon analysis.
 *
 * Responsibilities:
 * - Tokenize cleaned community texts.
 * - Remove language-specific stop words.
 * - Remove very short and low-value tokens.
 * - Prioritize meaningful lexicon matches.
 * - Count keyword frequency across relevant posts and comments.
 * - Return sorted weighted keywords for prompt generation and insight extraction.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class KeywordExtractionService {
    private readonly minimumTokenLength = 3;
    private readonly maxKeywords = 30;

    /**
     * Extracts the most frequent meaningful keywords from analyzed texts.
     *
     * @param analyzedTexts Lexicon-enriched text analysis results.
     * @returns Weighted keywords sorted by frequency.
     */
    extract(analyzedTexts: LexiconTextAnalysisResult[]): WeightedKeyword[] {
        const frequencyMap = new Map<string, number>();

        for (const text of analyzedTexts) {
            const stopWords = STOP_WORDS[text.language] ?? [];
            const tokens = this.extractTokens(text.cleanedText, stopWords);
            const lexiconTerms = this.extractPriorityLexiconTerms(text);

            for (const token of [...tokens, ...lexiconTerms]) {
                frequencyMap.set(token, (frequencyMap.get(token) ?? 0) + 1);
            }
        }

        return [...frequencyMap.entries()]
            .map(([keyword, frequency]) => ({
                keyword,
                frequency,
            }))
            .sort((first, second) => {
                if (second.frequency !== first.frequency) {
                    return second.frequency - first.frequency;
                }

                return first.keyword.localeCompare(second.keyword);
            })
            .slice(0, this.maxKeywords);
    }

    /**
     * Extracts normalized tokens from cleaned text.
     *
     * @param cleanedText Cleaned text produced by the preprocessing stage.
     * @param stopWords Language-specific stop words.
     * @returns Meaningful tokens.
     */
    private extractTokens(cleanedText: string, stopWords: string[]): string[] {
        const stopWordSet = new Set(stopWords.map((word) => word.toLowerCase()));

        return cleanedText
            .split(/\s+/)
            .map((token) => token.toLowerCase().trim())
            .filter((token) => this.isValidToken(token, stopWordSet));
    }

    /**
     * Extracts important lexicon terms that should influence keyword ranking.
     *
     * Problem, need, complaint, urgency, cost, time, accessibility, safety,
     * reliability, opportunity, and feature-request terms are given priority
     * because they directly support Nexora AI idea generation requirements.
     *
     * @param text Lexicon-enriched text analysis result.
     * @returns Priority lexicon terms.
     */
    private extractPriorityLexiconTerms(
        text: LexiconTextAnalysisResult,
    ): string[] {
        const priorityTypes = [
            NlpLexiconType.PROBLEM,
            NlpLexiconType.NEED,
            NlpLexiconType.COMPLAINT,
            NlpLexiconType.URGENCY,
            NlpLexiconType.COST,
            NlpLexiconType.TIME,
            NlpLexiconType.ACCESSIBILITY,
            NlpLexiconType.SAFETY,
            NlpLexiconType.RELIABILITY,
            NlpLexiconType.OPPORTUNITY,
            NlpLexiconType.FEATURE_REQUEST,
        ];

        return priorityTypes.flatMap((type) => text.matchedLexicons[type] ?? []);
    }

    /**
     * Validates whether a token should be counted as a keyword.
     *
     * @param token Normalized token.
     * @param stopWords Language-specific stop word set.
     * @returns True when the token is meaningful.
     */
    private isValidToken(token: string, stopWords: Set<string>): boolean {
        if (!token) {
            return false;
        }

        if (token.length < this.minimumTokenLength) {
            return false;
        }

        if (stopWords.has(token)) {
            return false;
        }

        if (/^\d+$/.test(token)) {
            return false;
        }

        return true;
    }
}