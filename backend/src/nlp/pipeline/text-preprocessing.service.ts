import { Injectable, Logger } from '@nestjs/common';
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
   * LanguageCode.ANY is not allowed here because every text forwarded to
   * language-aware analysis must have a specific supported language.
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
   * Text inputs that passed cleaning, duplicate filtering,
   * language resolution, and domain-relevance filtering.
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
   * Number of texts removed because a specific supported language
   * could not be resolved reliably.
   */
  unresolvedLanguageTextsRemoved: number;

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
 * Internal item produced after cleaning and duplicate filtering.
 *
 * @author Eman
 */
type CleanedTextItem = {
  readonly input: IntelligentTextInput;
  readonly cleaning: CleanTextResult;
};

/**
 * Internal item containing a cleaned text and its successfully
 * resolved language.
 *
 * @author Eman
 */
type LanguageResolvedTextItem = CleanedTextItem & {
  readonly finalLanguage: ResolvedLanguageCode;
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
 * - Resolve a specific supported language for every accepted text.
 * - Exclude texts whose language cannot be resolved reliably.
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
  private readonly logger = new Logger(TextPreprocessingService.name);

  constructor(
    private readonly textCleaningService: TextCleaningService,
    private readonly languageDetectionService: LanguageDetectionService,
    private readonly domainRelevanceService: DomainRelevanceService,
  ) {}

  /**
   * Runs preprocessing for collected posts and comments.
   *
   * Individual texts whose language cannot be resolved are excluded instead
   * of terminating the complete NLP analysis. Community sources can contain
   * short identifiers, code fragments, links, emoji-only comments, or mixed
   * language content that cannot be classified reliably.
   *
   * @param inputs Unified post and comment inputs.
   * @param domainKeywords Domain keywords used to evaluate relevance.
   * @returns Cleaned, deduplicated, language-aware, and relevant texts.
   */
  process(
    inputs: ReadonlyArray<IntelligentTextInput>,
    domainKeywords: ReadonlyArray<string>,
    fallbackLanguage: LanguageCode = LanguageCode.EN,
  ): TextPreprocessingOutput {
    const cleanedItems: CleanedTextItem[] = inputs.map((input) => ({
      input,
      cleaning: this.textCleaningService.clean(input.content),
    }));

    const nonEmptyItems = cleanedItems.filter((item) => !item.cleaning.isEmpty);

    const emptyTextsRemoved = cleanedItems.length - nonEmptyItems.length;

    const uniqueItems = this.removeDuplicateItems(nonEmptyItems);

    const duplicateTextsRemoved = nonEmptyItems.length - uniqueItems.length;

    const languageResolvedItems = this.resolveItemLanguages(
      uniqueItems,
      fallbackLanguage,
    );

    const unresolvedLanguageTextsRemoved =
      uniqueItems.length - languageResolvedItems.length;

    const evaluatedTexts: RelevanceEvaluatedText[] = languageResolvedItems.map(
      (item) => {
        const relevance = this.domainRelevanceService.analyze(
          item.cleaning.cleanedText,
          domainKeywords,
        );

        const text: PreprocessedTextInput = {
          ...item.input,
          cleaning: item.cleaning,
          finalLanguage: item.finalLanguage,
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

    /*
     * Collection already performs the authoritative relevance decision before
     * persistence. NLP therefore analyzes every stored, non-empty, unique text
     * instead of silently applying a second destructive relevance filter.
     * Relevance scores are still preserved as analytical metadata.
     */
    const relevantTexts = evaluatedTexts.map((item) => item.text);
    const irrelevantTextsRemoved = 0;

    if (unresolvedLanguageTextsRemoved > 0) {
      this.logger.debug(
        `Removed ${unresolvedLanguageTextsRemoved} text(s) because a specific supported language could not be resolved.`,
      );
    }

    return {
      texts: relevantTexts,
      emptyTextsRemoved,
      duplicateTextsRemoved,
      unresolvedLanguageTextsRemoved,
      irrelevantTextsRemoved,
      initialAnalysisResults: this.buildInitialAnalysisResults(relevantTexts),
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
   * Resolves languages for cleaned text items.
   *
   * Items whose language remains generic or unsupported are excluded.
   * Excluding only the affected item prevents one ambiguous community text
   * from terminating the complete collection-job NLP analysis.
   *
   * @param items Cleaned and deduplicated text items.
   * @returns Items with a successfully resolved specific language.
   */
  private resolveItemLanguages(
    items: ReadonlyArray<CleanedTextItem>,
    fallbackLanguage: LanguageCode,
  ): LanguageResolvedTextItem[] {
    const resolvedItems: LanguageResolvedTextItem[] = [];

    for (const item of items) {
      const finalLanguage = this.resolveLanguage(
        item.input.language,
        item.cleaning.cleanedText,
        fallbackLanguage,
      );

      if (finalLanguage === null) {
        this.logger.debug(
          `Skipping text "${item.input.id}" because its language could not be resolved.`,
        );

        continue;
      }

      resolvedItems.push({
        ...item,
        finalLanguage,
      });
    }

    return resolvedItems;
  }

  /**
   * Resolves the final specific language used for NLP analysis.
   *
   * Collector-provided languages are reused when valid and specific.
   * Missing or generic values are resolved through language detection.
   *
   * A null result means that the language detector could not classify the
   * text as one of the specific languages supported by the NLP pipeline.
   *
   * @param storedLanguage Language stored during data collection.
   * @param cleanedText Cleaned text used for fallback detection.
   * @returns A specific supported language, or null when unresolved.
   */
  private resolveLanguage(
    storedLanguage: LanguageCode | null | undefined,
    cleanedText: string,
    fallbackLanguage: LanguageCode,
  ): ResolvedLanguageCode | null {
    if (
      storedLanguage !== null &&
      storedLanguage !== undefined &&
      storedLanguage !== LanguageCode.ANY
    ) {
      return storedLanguage;
    }

    const detectedLanguage =
      this.languageDetectionService.detectCode(cleanedText);

    if (detectedLanguage !== LanguageCode.ANY) {
      return detectedLanguage;
    }

    /*
     * A short but meaningful text must not disappear only because language
     * detection is inconclusive. Reuse the collection language when specific;
     * otherwise use English as the neutral supported fallback.
     */
    return fallbackLanguage !== LanguageCode.ANY
      ? fallbackLanguage
      : LanguageCode.EN;
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
