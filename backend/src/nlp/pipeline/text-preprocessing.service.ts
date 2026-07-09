import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { DomainRelevanceService } from '../domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from '../language-detection/language-detection.service';
import {
    CleanTextResult,
    TextCleaningService,
} from '../text-cleaning/text-cleaning.service';
import {
    IntelligentTextInput,
    TextAnalysisResult,
} from './types/intelligent-analysis.types';
import { Sentiment } from '../common/enums/sentiment.enum';

/**
 * Represents a cleaned and validated text item ready for deeper NLP analysis.
 *
 * This type preserves the original metadata from the collected post or comment
 * while adding preprocessing results such as cleaned text, final language,
 * and domain relevance score.
 */
export type PreprocessedTextInput = IntelligentTextInput & {
    /**
     * Original raw text and its cleaned representation.
     */
    cleaning: CleanTextResult;

    /**
     * Final language used by the NLP pipeline.
     *
     * If the collector already stored a language, it is reused.
     * Otherwise, the language is detected from the cleaned text.
     */
    finalLanguage: LanguageCode;

    /**
     * Relevance score between 0 and 1 showing how strongly the text matches
     * the selected project domain.
     */
    relevanceScore: number;

    /**
     * Confidence score between 0 and 1 from the domain relevance check.
     */
    relevanceConfidence: number;

    /**
     * Single-word domain keywords matched in the cleaned text.
     */
    matchedKeywords: string[];

    /**
     * Multi-word domain phrases matched in the cleaned text.
     */
    matchedPhrases: string[];
};

/**
 * Summary returned after preprocessing collected community texts.
 *
 * This summary is used later by the Intelligent NLP Engine to calculate
 * data quality, build transparent analysis outputs, and support prompt
 * generation with reliable community evidence.
 */
export type TextPreprocessingOutput = {
    /**
     * Text inputs that passed cleaning, duplicate filtering, and domain relevance.
     */
    texts: PreprocessedTextInput[];

    /**
     * Number of empty texts removed after cleaning.
     */
    emptyTextsRemoved: number;

    /**
     * Number of duplicate texts removed after normalization.
     */
    duplicateTextsRemoved: number;

    /**
     * Number of texts removed because they were not related to the selected domain.
     */
    irrelevantTextsRemoved: number;

    /**
     * Initial per-text analysis records used for debugging and auditing.
     *
     * Later NLP services enrich these records with sentiment, lexicon matches,
     * extracted insights, and confidence values.
     */
    initialAnalysisResults: TextAnalysisResult[];
};

/**
 * Preprocesses unified text inputs before deeper NLP analysis.
 *
 * This service represents the second step of the Nexora AI Intelligent NLP
 * Engine. It receives unified inputs produced by TextInputBuilderService and
 * prepares them for lexicon analysis, keyword extraction, recurring problem
 * detection, and final AI prompt generation.
 *
 * Responsibilities:
 * - Clean raw post and comment content.
 * - Remove empty and duplicate texts.
 * - Resolve the final language for every text.
 * - Filter unrelated texts based on selected domain keywords.
 * - Produce initial analysis records for auditing and observability.
 *
 * This service intentionally does not perform sentiment analysis, keyword
 * extraction, topic detection, or persistence. Those responsibilities belong
 * to later services in the NLP pipeline.
 *
 * @author Eman
 */
@Injectable()
export class TextPreprocessingService {
    constructor(
        private readonly textCleaningService: TextCleaningService,
        private readonly languageDetectionService: LanguageDetectionService,
        private readonly domainRelevanceService: DomainRelevanceService,
    ) { }

    /**
     * Runs the preprocessing stage for collected posts and comments.
     *
     * @param inputs Unified post and comment inputs.
     * @param domainKeywords Domain keywords used to validate relevance.
     * @returns Cleaned, deduplicated, language-aware, and domain-relevant texts.
     */
    process(
        inputs: IntelligentTextInput[],
        domainKeywords: string[],
    ): TextPreprocessingOutput {
        const cleanedItems = inputs.map((input) => ({
            input,
            cleaning: this.textCleaningService.clean(input.content),
        }));

        const nonEmptyItems = cleanedItems.filter((item) => !item.cleaning.isEmpty);

        const emptyTextsRemoved = cleanedItems.length - nonEmptyItems.length;

        const uniqueItems = this.removeDuplicateItems(nonEmptyItems);

        const duplicateTextsRemoved = nonEmptyItems.length - uniqueItems.length;

        const preprocessedItems = uniqueItems.map((item) => {
            const finalLanguage = this.resolveLanguage(
                item.input.language,
                item.cleaning.cleanedText,
            );

            const relevance = this.domainRelevanceService.analyze(
                item.cleaning.cleanedText,
                domainKeywords,
            );

            return {
                ...item.input,
                cleaning: item.cleaning,
                finalLanguage,
                relevanceScore: relevance.score,
                relevanceConfidence: relevance.confidence,
                matchedKeywords: relevance.matchedKeywords,
                matchedPhrases: relevance.matchedPhrases,
                isRelevant: relevance.isRelevant,
            };
        });

        const relevantTexts = preprocessedItems
            .filter((item) => item.isRelevant)
            .map(({ isRelevant: _isRelevant, ...item }) => item);

        const irrelevantTextsRemoved =
            preprocessedItems.length - relevantTexts.length;

        return {
            texts: relevantTexts,
            emptyTextsRemoved,
            duplicateTextsRemoved,
            irrelevantTextsRemoved,
            initialAnalysisResults: this.buildInitialAnalysisResults(relevantTexts),
        };
    }

    /**
     * Removes duplicate collected texts based on their cleaned representation.
     *
     * Duplicates commonly appear when the same post or comment is collected from
     * repeated API runs, shared discussions, or mirrored community content.
     *
     * @param items Cleaned input items.
     * @returns Unique cleaned input items.
     */
    private removeDuplicateItems<T extends { cleaning: CleanTextResult }>(
        items: T[],
    ): T[] {
        const seen = new Set<string>();

        return items.filter((item) => {
            const key = item.cleaning.cleanedText;

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }

    /**
     * Resolves the final language used for NLP analysis.
     *
     * Collector-provided languages are trusted when available and specific.
     * Unknown, mixed, or missing languages are resolved using lightweight
     * language detection on cleaned text.
     *
     * @param storedLanguage Language stored during data collection.
     * @param cleanedText Cleaned text used for fallback detection.
     * @returns Final language code.
     */
    private resolveLanguage(
        storedLanguage: LanguageCode | null | undefined,
        cleanedText: string,
    ): LanguageCode {
        if (storedLanguage && storedLanguage !== LanguageCode.ANY) {
            return storedLanguage;
        }

        return this.languageDetectionService.detect(cleanedText);
    }

    /**
     * Builds initial analysis records for preprocessed texts.
     *
     * These records provide a consistent audit structure from the beginning of
     * the NLP pipeline. Later services may update sentiment, confidence,
     * lexicon matches, and AI usage flags.
     *
     * @param texts Preprocessed and domain-relevant texts.
     * @returns Initial per-text analysis records.
     */
    private buildInitialAnalysisResults(
        texts: PreprocessedTextInput[],
    ): TextAnalysisResult[] {
        return texts.map((text) => ({
            id: text.id,
            sourceType: text.sourceType,
            postId: text.postId,
            originalText: text.cleaning.originalText,
            cleanedText: text.cleaning.cleanedText,
            language: text.finalLanguage,
            sentiment: Sentiment.NEUTRAL,
            confidence: text.relevanceConfidence,
            matchedLexicons: {},
            aiUsed: false,
        }));
    }
}