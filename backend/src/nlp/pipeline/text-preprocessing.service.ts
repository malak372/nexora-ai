import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import { DomainRelevanceService } from '../domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from '../language-detection/language-detection.service';
import {
  type CleanTextResult,
  TextCleaningService,
} from '../text-cleaning/text-cleaning.service';

import type {
  IntelligentTextInput,
  ResolvedLanguageCode,
  TextAnalysisResult,
} from './types/intelligent-analysis.types';

/**
 * Represents a cleaned and validated text item ready for deeper NLP analysis.
 *
 * This type preserves the original metadata from the collected post or comment
 * while adding preprocessing results such as cleaned text, resolved language,
 * and domain-relevance information.
 *
 * @author Eman
 */
export type PreprocessedTextInput = IntelligentTextInput & {
  /**
   * Original raw text and its cleaned representation.
   */
  cleaning: CleanTextResult;

  /**
   * Final specific language used by the NLP pipeline.
   *
   * ANY is not allowed here because every individual text must have a
   * resolved supported language before language-aware analysis begins.
   */
  finalLanguage: ResolvedLanguageCode;

  /**
   * Relevance score in the range [0, 1] showing how strongly the text
   * matches the selected software domain.
   */
  relevanceScore: number;

  /**
   * Confidence score in the range [0, 1] produced by domain-relevance
   * analysis.
   */
  relevanceConfidence: number;

  /**
   * Single-word domain keywords matched in the cleaned text.
   */
  matchedKeywords: readonly string[];

  /**
   * Multi-word domain phrases matched in the cleaned text.
   */
  matchedPhrases: readonly string[];
};

/**
 * Internal preprocessing result containing the prepared text and its
 * domain-relevance decision.
 *
 * The relevance flag remains internal and is not forwarded to later
 * NLP pipeline stages.
 *
 * @author Eman
 */
type RelevanceEvaluatedText = {
  readonly text: PreprocessedTextInput;
  readonly isRelevant: boolean;
};

/**
 * Summary returned after preprocessing collected community texts.
 *
 * This summary is used later by the intelligent NLP pipeline to calculate
 * data quality, build transparent analysis outputs, and provide reliable
 * community evidence for prompt generation.
 *
 * @author Eman
 */
export type TextPreprocessingOutput = {
  /**
   * Text inputs that passed cleaning, duplicate filtering, and
   * domain-relevance filtering.
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
   * Number of texts removed because they were not related to the
   * selected domain.
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
 * This service receives unified post and comment inputs produced by
 * TextInputBuilderService and prepares them for:
 * - Lexicon analysis.
 * - Keyword extraction.
 * - Topic extraction.
 * - Recurring-problem detection.
 * - Need and opportunity extraction.
 * - Optional AI enhancement.
 *
 * Responsibilities:
 * - Clean raw post and comment content.
 * - Remove empty and duplicate texts.
 * - Resolve a specific language for every text.
 * - Filter unrelated texts using selected-domain keywords.
 * - Preserve relevance metadata for later confidence calculations.
 * - Produce initial analysis records for auditing and observability.
 *
 * This service does not:
 * - Perform sentiment analysis.
 * - Extract keywords or topics.
 * - Generate analytical insights.
 * - Call external AI services.
 * - Persist NLP analysis.
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
   * Runs preprocessing for collected posts and comments.
   *
   * @param inputs Unified post and comment inputs.
   * @param domainKeywords Domain keywords used to evaluate relevance.
   * @returns Cleaned, deduplicated, language-aware, and relevant texts.
   */
  process(
    inputs: ReadonlyArray<IntelligentTextInput>,
    domainKeywords: ReadonlyArray<string>,
  ): TextPreprocessingOutput {
    const cleanedItems = inputs.map((input) => ({
      input,
      cleaning: this.textCleaningService.clean(input.content),
    }));

    const nonEmptyItems = cleanedItems.filter(
      (item) => !item.cleaning.isEmpty,
    );

    const emptyTextsRemoved =
      cleanedItems.length - nonEmptyItems.length;

    const uniqueItems = this.removeDuplicateItems(nonEmptyItems);

    const duplicateTextsRemoved =
      nonEmptyItems.length - uniqueItems.length;

    const evaluatedTexts: RelevanceEvaluatedText[] = uniqueItems.map(
      (item) => {
        const finalLanguage = this.resolveLanguage(
          item.input.language,
          item.cleaning.cleanedText,
        );

        const relevance = this.domainRelevanceService.analyze(
          item.cleaning.cleanedText,
          domainKeywords,
        );

        const text: PreprocessedTextInput = {
          ...item.input,
          cleaning: item.cleaning,
          finalLanguage,
          relevanceScore: relevance.score,
          relevanceConfidence: relevance.confidence,
          matchedKeywords: relevance.matchedKeywords,
          matchedPhrases: relevance.matchedPhrases,
        };

        return {
          text,
          isRelevant: relevance.isRelevant,
        };
      },
    );

    const relevantTexts = evaluatedTexts
      .filter((item) => item.isRelevant)
      .map((item) => item.text);

    const irrelevantTextsRemoved =
      evaluatedTexts.length - relevantTexts.length;

    return {
      texts: relevantTexts,
      emptyTextsRemoved,
      duplicateTextsRemoved,
      irrelevantTextsRemoved,
      initialAnalysisResults:
        this.buildInitialAnalysisResults(relevantTexts),
    };
  }

  /**
   * Removes duplicate collected texts based on their cleaned representation.
   *
   * The first occurrence is preserved to retain stable upstream ordering.
   *
   * @param items Cleaned input items.
   * @returns Unique cleaned input items.
   */
  private removeDuplicateItems<
    T extends Readonly<{ cleaning: CleanTextResult }>,
  >(items: ReadonlyArray<T>): T[] {
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
   * Resolves the final specific language used for NLP analysis.
   *
   * Collector-provided languages are reused when valid and specific.
   * Missing or generic values are resolved through language detection.
   *
   * @param storedLanguage Language stored during data collection.
   * @param cleanedText Cleaned text used for fallback detection.
   * @returns Specific supported language code.
   * @throws Error When no specific supported language can be resolved.
   */
  private resolveLanguage(
    storedLanguage: LanguageCode | null | undefined,
    cleanedText: string,
  ): ResolvedLanguageCode {
    if (
      storedLanguage !== null &&
      storedLanguage !== undefined &&
      storedLanguage !== LanguageCode.ANY
    ) {
      return storedLanguage;
    }

    const detectedLanguage =
      this.languageDetectionService.detectCode(cleanedText);

    if (detectedLanguage === LanguageCode.ANY) {
      throw new Error(
        'Unable to resolve a supported language for the analyzed text.',
      );
    }

    return detectedLanguage;
  }

  /**
   * Builds initial analysis records for preprocessed texts.
   *
   * These records provide a consistent structure from the beginning of the
   * pipeline. Later services replace the initial neutral sentiment and enrich
   * confidence, lexicon matches, and AI-usage metadata.
   *
   * @param texts Preprocessed and domain-relevant texts.
   * @returns Initial per-text analysis records.
   */
  private buildInitialAnalysisResults(
    texts: ReadonlyArray<PreprocessedTextInput>,
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