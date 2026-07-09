import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Provides database-driven NLP lexicon access for the Nexora AI analysis pipeline.
 *
 * The lexicon contains configurable words and indicators used to detect sentiment,
 * recurring problems, user needs, urgency, cost concerns, reliability issues, and
 * other signals from collected community posts and comments.
 *
 * Keeping these terms in the database allows the system to evolve without changing
 * the source code, and enables future Admin management for multilingual NLP rules.
 *
 * @author Eman
 */
@Injectable()
export class NlpLexiconService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Retrieves active lexicon words for a specific type and language.
     *
     * The method includes:
     * - Words that match the selected/detected language.
     * - Global words marked as `ANY`.
     *
     * Returned words are normalized to lowercase and trimmed to make matching
     * consistent across NLP services.
     *
     * @param type NLP lexicon category such as PROBLEM, NEED, POSITIVE, or URGENCY.
     * @param language Selected or detected language code.
     * @returns Normalized active words for the requested lexicon type.
     */
    async getWords(
        type: NlpLexiconType,
        language: LanguageCode,
    ): Promise<string[]> {
        const lexicons = await this.prisma.nlpLexicon.findMany({
            where: {
                type,
                isActive: true,
                language: {
                    in: [language, LanguageCode.ANY],
                },
            },
            select: {
                word: true,
            },
            orderBy: {
                word: 'asc',
            },
        });

        return lexicons.map((item) => item.word.toLowerCase().trim());
    }

    /**
     * Retrieves active lexicon words for multiple NLP categories in one query.
     *
     * This is useful for analysis services that need several lexicon groups at once,
     * such as sentiment analysis, problem detection, and insight classification.
     *
     * @param types Lexicon categories to retrieve.
     * @param language Selected or detected language code.
     * @returns A record where each requested type maps to its normalized words.
     */
    async getWordsByTypes(
        types: NlpLexiconType[],
        language: LanguageCode,
    ): Promise<Record<NlpLexiconType, string[]>> {
        const lexicons = await this.prisma.nlpLexicon.findMany({
            where: {
                type: {
                    in: types,
                },
                isActive: true,
                language: {
                    in: [language, LanguageCode.ANY],
                },
            },
            select: {
                word: true,
                type: true,
            },
            orderBy: {
                word: 'asc',
            },
        });

        const result = types.reduce(
            (acc, type) => {
                acc[type] = [];
                return acc;
            },
            {} as Record<NlpLexiconType, string[]>,
        );

        for (const item of lexicons) {
            result[item.type].push(item.word.toLowerCase().trim());
        }

        return result;
    }

    /**
     * Retrieves positive sentiment words.
     */
    async getPositiveWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.POSITIVE, language);
    }

    /**
     * Retrieves negative sentiment words.
     */
    async getNegativeWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.NEGATIVE, language);
    }

    /**
     * Retrieves words that indicate real user problems or pain points.
     */
    async getProblemWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.PROBLEM, language);
    }

    /**
     * Retrieves words that indicate user needs or unmet requirements.
     */
    async getNeedWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.NEED, language);
    }

    /**
     * Retrieves words that indicate feature requests or improvement suggestions.
     */
    async getFeatureRequestWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.FEATURE_REQUEST, language);
    }

    /**
     * Retrieves words that indicate explicit complaints.
     */
    async getComplaintWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.COMPLAINT, language);
    }

    /**
     * Retrieves words that indicate urgency or high-priority needs.
     */
    async getUrgencyWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.URGENCY, language);
    }

    /**
     * Retrieves words that indicate cost, pricing, or affordability concerns.
     */
    async getCostWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.COST, language);
    }

    /**
     * Retrieves words that indicate time, delay, waiting, or speed concerns.
     */
    async getTimeWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.TIME, language);
    }

    /**
     * Retrieves words that indicate usability or accessibility barriers.
     */
    async getAccessibilityWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.ACCESSIBILITY, language);
    }

    /**
     * Retrieves words that indicate safety, security, or privacy concerns.
     */
    async getSafetyWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.SAFETY, language);
    }

    /**
     * Retrieves words that indicate reliability problems such as bugs, crashes,
     * downtime, or unstable system behavior.
     */
    async getReliabilityWords(language: LanguageCode): Promise<string[]> {
        return this.getWords(NlpLexiconType.RELIABILITY, language);
    }
}