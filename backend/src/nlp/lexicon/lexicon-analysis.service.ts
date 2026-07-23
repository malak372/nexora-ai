import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import { TextAnalysisResult } from '../pipeline/types/intelligent-analysis.types';
import { PreprocessedTextInput } from '../pipeline/text-preprocessing.service';

import { NlpLexiconService } from './nlp-lexicon.service';

/**
 * Lexicon groups indexed by NLP lexicon type.
 *
 * @author Eman
 */
type LexiconsByType = Record<NlpLexiconType, readonly string[]>;

/**
 * Represents the result of lexicon-based analysis for a single text item.
 *
 * @author Eman
 */
export type LexiconTextAnalysisResult = TextAnalysisResult & {
  /**
   * Number of matched lexicon terms across all categories.
   */
  readonly totalLexiconMatches: number;

  /**
   * Number of positive lexicon matches.
   */
  readonly positiveMatches: number;

  /**
   * Number of negative lexicon matches.
   */
  readonly negativeMatches: number;
};

/**
 * Output returned after running lexicon analysis on preprocessed texts.
 *
 * @author Eman
 */
export type LexiconAnalysisOutput = {
  /**
   * Enriched text-analysis records after lexicon matching.
   */
  readonly analyzedTexts: readonly LexiconTextAnalysisResult[];

  /**
   * Number of analyzed texts.
   */
  readonly totalAnalyzed: number;

  /**
   * Number of texts classified as positive.
   */
  readonly positiveTexts: number;

  /**
   * Number of texts classified as negative.
   */
  readonly negativeTexts: number;

  /**
   * Number of texts classified as neutral.
   */
  readonly neutralTexts: number;
};

/**
 * Performs multilingual, rule-based lexicon analysis on preprocessed texts.
 *
 * Responsibilities:
 * - Load configured lexicons once for every language used in the analysis run.
 * - Match cleaned posts and comments against all lexicon categories.
 * - Calculate initial sentiment from positive and negative signals.
 * - Calculate a confidence score for every analyzed text.
 * - Enrich analysis records for later NLP stages.
 *
 * This service is stateless and does not persist analysis results.
 *
 * @author Eman
 */
@Injectable()
export class LexiconAnalysisService {
  /**
   * Number of lexicon matches considered sufficient for maximum
   * match-density confidence.
   */
  private static readonly FULL_MATCH_CONFIDENCE_COUNT = 6;

  /**
   * Positive-to-negative match difference considered sufficient
   * for maximum sentiment-strength confidence.
   */
  private static readonly FULL_SENTIMENT_STRENGTH_DIFFERENCE = 3;

  /**
   * Minimum confidence returned when no lexicon terms are matched.
   */
  private static readonly MINIMUM_FALLBACK_CONFIDENCE = 0.1;

  constructor(private readonly nlpLexiconService: NlpLexiconService) {}

  /**
   * Runs lexicon analysis for all preprocessed texts.
   *
   * @param texts Preprocessed and domain-relevant text inputs.
   * @param initialResults Initial analysis records from preprocessing.
   * @returns Lexicon-enriched analysis output.
   */
  async analyze(
    texts: readonly PreprocessedTextInput[],
    initialResults: readonly TextAnalysisResult[],
  ): Promise<LexiconAnalysisOutput> {
    if (texts.length === 0) {
      return this.buildEmptyOutput();
    }

    const lexiconsByLanguage = await this.loadLexiconsByLanguage(texts);
    const initialResultsById = new Map(
      initialResults.map((result) => [result.id, result]),
    );

    const analyzedTexts = texts.map((text) =>
      this.analyzeText(
        text,
        lexiconsByLanguage.get(text.finalLanguage) ?? this.buildEmptyLexicons(),
        initialResultsById.get(text.id),
      ),
    );

    return this.buildOutput(analyzedTexts);
  }

  /**
   * Analyzes one preprocessed text using language-specific lexicons.
   *
   * @param text Preprocessed text input.
   * @param lexicons Lexicon terms grouped by type.
   * @param baseResult Optional initial analysis record.
   * @returns Enriched text-analysis result.
   */
  private analyzeText(
    text: PreprocessedTextInput,
    lexicons: LexiconsByType,
    baseResult?: TextAnalysisResult,
  ): LexiconTextAnalysisResult {
    const matchedLexicons = this.matchLexicons(
      text.cleaning.cleanedText,
      lexicons,
    );

    const positiveMatches =
      matchedLexicons[NlpLexiconType.POSITIVE]?.length ?? 0;

    const negativeMatches =
      matchedLexicons[NlpLexiconType.NEGATIVE]?.length ?? 0;

    const totalLexiconMatches = Object.values(matchedLexicons).reduce(
      (total, matches) => total + (matches?.length ?? 0),
      0,
    );

    return {
      id: text.id,
      sourceType: text.sourceType,
      postId: text.postId,
      originalText: text.cleaning.originalText,
      cleanedText: text.cleaning.cleanedText,
      language: text.finalLanguage,
      sentiment: this.calculateSentiment(positiveMatches, negativeMatches),
      confidence: this.calculateConfidence(
        totalLexiconMatches,
        positiveMatches,
        negativeMatches,
        text.relevanceConfidence,
      ),
      matchedLexicons,
      aiUsed: baseResult?.aiUsed ?? false,
      totalLexiconMatches,
      positiveMatches,
      negativeMatches,
    };
  }

  /**
   * Loads and normalizes lexicons for all languages present in the input.
   *
   * Each language is loaded once. Independent database reads are executed
   * concurrently to reduce total analysis latency.
   *
   * @param texts Preprocessed text inputs.
   * @returns Lexicons grouped by language and type.
   */
  private async loadLexiconsByLanguage(
    texts: readonly PreprocessedTextInput[],
  ): Promise<Map<LanguageCode, LexiconsByType>> {
    const languages = [...new Set(texts.map((text) => text.finalLanguage))];

    const entries = await Promise.all(
      languages.map(async (language) => {
        const lexicons = await this.nlpLexiconService.getGroupedWords(language);

        return [language, this.normalizeLexicons(lexicons)] as const;
      }),
    );

    return new Map(entries);
  }

  /**
   * Normalizes and deduplicates all lexicon terms once before text matching.
   *
   * @param lexicons Raw lexicon groups loaded from storage.
   * @returns Normalized lexicon groups.
   */
  private normalizeLexicons(
    lexicons: Record<NlpLexiconType, string[]>,
  ): LexiconsByType {
    const normalizedLexicons = this.buildEmptyLexicons();

    for (const type of this.getLexiconTypes()) {
      normalizedLexicons[type] = [
        ...new Set(
          (lexicons[type] ?? [])
            .map((term) => this.normalizeText(term))
            .filter(Boolean),
        ),
      ];
    }

    return normalizedLexicons;
  }

  /**
   * Matches cleaned text against every configured lexicon category.
   *
   * @param cleanedText Cleaned text ready for analysis.
   * @param lexicons Normalized lexicon terms grouped by category.
   * @returns Matched terms grouped by category.
   */
  private matchLexicons(
    cleanedText: string,
    lexicons: LexiconsByType,
  ): Partial<Record<NlpLexiconType, string[]>> {
    const normalizedText = this.normalizeText(cleanedText);
    const matches: Partial<Record<NlpLexiconType, string[]>> = {};

    if (!normalizedText) {
      return matches;
    }

    for (const type of this.getLexiconTypes()) {
      const matchedTerms = lexicons[type].filter((term) =>
        this.containsTerm(normalizedText, term),
      );

      if (matchedTerms.length > 0) {
        matches[type] = matchedTerms;
      }
    }

    return matches;
  }

  /**
   * Determines whether normalized text contains a complete lexicon term.
   *
   * Unicode-aware letter and number boundaries allow matches beside
   * punctuation while preventing partial-word matches.
   *
   * @param normalizedText Normalized text.
   * @param normalizedTerm Normalized lexicon term.
   * @returns True when the complete term appears in the text.
   */
  private containsTerm(
    normalizedText: string,
    normalizedTerm: string,
  ): boolean {
    if (!normalizedText || !normalizedTerm) {
      return false;
    }

    const escapedTerm = this.escapeRegExp(normalizedTerm);

    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapedTerm}(?![\\p{L}\\p{N}_])`,
      'iu',
    );

    return pattern.test(normalizedText);
  }

  /**
   * Calculates sentiment from positive and negative lexicon signals.
   *
   * @param positiveMatches Number of positive matches.
   * @param negativeMatches Number of negative matches.
   * @returns Final sentiment classification.
   */
  private calculateSentiment(
    positiveMatches: number,
    negativeMatches: number,
  ): Sentiment {
    if (positiveMatches === negativeMatches) {
      return Sentiment.NEUTRAL;
    }

    return positiveMatches > negativeMatches
      ? Sentiment.POSITIVE
      : Sentiment.NEGATIVE;
  }

  /**
   * Calculates confidence for a lexicon-based analysis result.
   *
   * Confidence combines:
   * - Lexicon match density.
   * - Positive/negative sentiment separation.
   * - Domain-relevance confidence.
   *
   * @param totalMatches Total lexicon matches.
   * @param positiveMatches Number of positive matches.
   * @param negativeMatches Number of negative matches.
   * @param relevanceConfidence Domain-relevance confidence.
   * @returns Confidence between 0 and 1.
   */
  private calculateConfidence(
    totalMatches: number,
    positiveMatches: number,
    negativeMatches: number,
    relevanceConfidence: number,
  ): number {
    const normalizedRelevanceConfidence = this.clamp(relevanceConfidence);

    if (totalMatches === 0) {
      return this.round(
        Math.max(
          normalizedRelevanceConfidence * 0.5,
          LexiconAnalysisService.MINIMUM_FALLBACK_CONFIDENCE,
        ),
      );
    }

    const matchConfidence = this.clamp(
      totalMatches / LexiconAnalysisService.FULL_MATCH_CONFIDENCE_COUNT,
    );

    const sentimentStrength = this.clamp(
      Math.abs(positiveMatches - negativeMatches) /
        LexiconAnalysisService.FULL_SENTIMENT_STRENGTH_DIFFERENCE,
    );

    return this.round(
      matchConfidence * 0.6 +
        sentimentStrength * 0.2 +
        normalizedRelevanceConfidence * 0.2,
    );
  }

  /**
   * Normalizes text and lexicon terms before matching.
   *
   * @param value Raw text value.
   * @returns Unicode-normalized lowercase text.
   */
  private normalizeText(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/gu, '')
      .toLocaleLowerCase()
      .trim()
      .replace(/\s+/gu, ' ');
  }

  /**
   * Escapes a value before inserting it into a regular expression.
   *
   * @param value Raw regular-expression value.
   * @returns Escaped value.
   */
  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  /**
   * Returns all Prisma NLP lexicon enum values with strong typing.
   *
   * @returns Supported lexicon types.
   */
  private getLexiconTypes(): NlpLexiconType[] {
    return Object.values(NlpLexiconType);
  }

  /**
   * Builds an empty lexicon object containing all configured categories.
   *
   * @returns Empty lexicon groups.
   */
  private buildEmptyLexicons(): Record<NlpLexiconType, string[]> {
    const lexicons = {} as Record<NlpLexiconType, string[]>;

    for (const type of this.getLexiconTypes()) {
      lexicons[type] = [];
    }

    return lexicons;
  }

  /**
   * Builds aggregate output statistics.
   *
   * @param analyzedTexts Completed per-text analysis records.
   * @returns Lexicon-analysis output.
   */
  private buildOutput(
    analyzedTexts: readonly LexiconTextAnalysisResult[],
  ): LexiconAnalysisOutput {
    let positiveTexts = 0;
    let negativeTexts = 0;
    let neutralTexts = 0;

    for (const text of analyzedTexts) {
      switch (text.sentiment) {
        case Sentiment.POSITIVE:
          positiveTexts += 1;
          break;

        case Sentiment.NEGATIVE:
          negativeTexts += 1;
          break;

        default:
          neutralTexts += 1;
      }
    }

    return {
      analyzedTexts,
      totalAnalyzed: analyzedTexts.length,
      positiveTexts,
      negativeTexts,
      neutralTexts,
    };
  }

  /**
   * Builds an empty analysis output.
   *
   * @returns Empty lexicon-analysis output.
   */
  private buildEmptyOutput(): LexiconAnalysisOutput {
    return {
      analyzedTexts: [],
      totalAnalyzed: 0,
      positiveTexts: 0,
      negativeTexts: 0,
      neutralTexts: 0,
    };
  }

  /**
   * Restricts a numeric value to the normalized range from 0 to 1.
   *
   * @param value Numeric value.
   * @returns Clamped value.
   */
  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Rounds a numeric value to three decimal places.
   *
   * @param value Numeric value.
   * @returns Rounded value.
   */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}
