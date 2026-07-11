import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import { TextAnalysisResult } from '../pipeline/types/intelligent-analysis.types';
import { PreprocessedTextInput } from '../pipeline/text-preprocessing.service';

import { NlpLexiconService } from './nlp-lexicon.service';

/**
 * Represents the result of lexicon-based analysis for a single text item.
 */
export type LexiconTextAnalysisResult = TextAnalysisResult & {
  /**
   * Number of matched lexicon terms across all categories.
   */
  totalLexiconMatches: number;

  /**
   * Number of positive lexicon matches.
   */
  positiveMatches: number;

  /**
   * Number of negative lexicon matches.
   */
  negativeMatches: number;
};

/**
 * Output returned after running lexicon analysis on preprocessed texts.
 */
export type LexiconAnalysisOutput = {
  /**
   * Enriched text analysis records after lexicon matching.
   */
  analyzedTexts: LexiconTextAnalysisResult[];

  /**
   * Number of analyzed texts.
   */
  totalAnalyzed: number;

  /**
   * Number of texts classified as positive.
   */
  positiveTexts: number;

  /**
   * Number of texts classified as negative.
   */
  negativeTexts: number;

  /**
   * Number of texts classified as neutral.
   */
  neutralTexts: number;
};

/**
 * Performs rule-based lexicon analysis on preprocessed community texts.
 *
 * This service is the first semantic analysis stage in the Nexora AI NLP
 * pipeline. It matches cleaned social posts and comments against configurable
 * lexicon entries stored in the database to detect meaningful community
 * signals before keyword extraction, problem detection, and AI prompt building.
 *
 * Responsibilities:
 * - Match texts against multilingual NLP lexicons.
 * - Detect problem, need, complaint, urgency, cost, time, accessibility,
 *   safety, reliability, opportunity, and feature-request signals.
 * - Calculate an initial sentiment label from positive and negative signals.
 * - Produce confidence scores for each analyzed text.
 * - Enrich per-text analysis records for later insight extraction.
 *
 * This service does not persist analysis results. Persistence is handled by
 * a later NLP persistence service.
 *
 * @author Eman
 */
@Injectable()
export class LexiconAnalysisService {
  constructor(private readonly nlpLexiconService: NlpLexiconService) {}

  /**
   * Runs lexicon analysis for all preprocessed texts.
   *
   * @param texts Preprocessed and domain-relevant text inputs.
   * @param initialResults Initial analysis records from preprocessing.
   * @returns Lexicon-enriched analysis output.
   */
  async analyze(
    texts: PreprocessedTextInput[],
    initialResults: TextAnalysisResult[],
  ): Promise<LexiconAnalysisOutput> {
    const lexiconsByLanguage = await this.loadLexiconsByLanguage(texts);

    const initialResultsById = new Map(
      initialResults.map((result) => [result.id, result]),
    );

    const analyzedTexts = texts.map((text) => {
      const baseResult = initialResultsById.get(text.id);

      return this.analyzeText(
        text,
        lexiconsByLanguage.get(text.finalLanguage) ?? this.buildEmptyLexicons(),
        baseResult,
      );
    });

    return {
      analyzedTexts,
      totalAnalyzed: analyzedTexts.length,

      positiveTexts: analyzedTexts.filter(
        (text) => text.sentiment === Sentiment.POSITIVE,
      ).length,

      negativeTexts: analyzedTexts.filter(
        (text) => text.sentiment === Sentiment.NEGATIVE,
      ).length,

      neutralTexts: analyzedTexts.filter(
        (text) => text.sentiment === Sentiment.NEUTRAL,
      ).length,
    };
  }

  /**
   * Analyzes one preprocessed text using lexicon matches.
   *
   * @param text Preprocessed text input.
   * @param lexicons Lexicon terms grouped by type.
   * @param baseResult Optional initial analysis record.
   * @returns Enriched text analysis result.
   */
  private analyzeText(
    text: PreprocessedTextInput,
    lexicons: Record<NlpLexiconType, string[]>,
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
      (total, matches) => total + matches.length,
      0,
    );

    const sentiment = this.calculateSentiment(positiveMatches, negativeMatches);

    const confidence = this.calculateConfidence(
      totalLexiconMatches,
      positiveMatches,
      negativeMatches,
      text.relevanceConfidence,
    );

    return {
      id: text.id,
      sourceType: text.sourceType,
      postId: text.postId,
      originalText: text.cleaning.originalText,
      cleanedText: text.cleaning.cleanedText,
      language: text.finalLanguage,
      sentiment,
      confidence,
      matchedLexicons,
      aiUsed: baseResult?.aiUsed ?? false,
      totalLexiconMatches,
      positiveMatches,
      negativeMatches,
    };
  }

  /**
   * Loads all required lexicons for the languages present in the input texts.
   *
   * Each language is loaded once and cached in a map for the duration of the
   * analysis run. This avoids repeated database calls while processing many
   * posts and comments in the same collection job.
   *
   * @param texts Preprocessed text inputs.
   * @returns Lexicon terms grouped by language and type.
   */
  private async loadLexiconsByLanguage(
    texts: PreprocessedTextInput[],
  ): Promise<Map<LanguageCode, Record<NlpLexiconType, string[]>>> {
    const languages = [...new Set(texts.map((text) => text.finalLanguage))];

    const result = new Map<LanguageCode, Record<NlpLexiconType, string[]>>();

    for (const language of languages) {
      result.set(language, await this.loadLexiconsForLanguage(language));
    }

    return result;
  }

  /**
   * Loads lexicon terms for one language and groups them by lexicon type.
   *
   * @param language Language used for lexicon lookup.
   * @returns Lexicon terms grouped by type.
   */
  private async loadLexiconsForLanguage(
    language: LanguageCode,
  ): Promise<Record<NlpLexiconType, string[]>> {
    return this.nlpLexiconService.getGroupedWords(language);
  }

  /**
   * Matches cleaned text against all configured lexicon categories.
   *
   * @param cleanedText Cleaned text ready for analysis.
   * @param lexicons Lexicon terms grouped by category.
   * @returns Matched lexicon terms grouped by category.
   */
  private matchLexicons(
    cleanedText: string,
    lexicons: Record<NlpLexiconType, string[]>,
  ): Partial<Record<NlpLexiconType, string[]>> {
    const matches: Partial<Record<NlpLexiconType, string[]>> = {};

    for (const [type, words] of Object.entries(lexicons) as [
      NlpLexiconType,
      string[],
    ][]) {
      const matchedWords = words.filter((word) =>
        this.containsTerm(cleanedText, word),
      );

      if (matchedWords.length > 0) {
        matches[type] = matchedWords;
      }
    }

    return matches;
  }

  /**
   * Determines whether a cleaned text contains a lexicon term.
   *
   * @param text Cleaned text.
   * @param term Lexicon term.
   * @returns True when the term appears in the text.
   */
  private containsTerm(text: string, term: string): boolean {
    const normalizedTerm = term.toLowerCase().trim();

    if (!normalizedTerm) {
      return false;
    }

    const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const pattern = new RegExp(`(^|\\s)${escapedTerm}(\\s|$)`, 'i');

    return pattern.test(text);
  }

  /**
   * Calculates sentiment from positive and negative lexicon signals.
   *
   * @param positiveMatches Number of positive signals.
   * @param negativeMatches Number of negative signals.
   * @returns Final sentiment classification.
   */
  private calculateSentiment(
    positiveMatches: number,
    negativeMatches: number,
  ): Sentiment {
    if (negativeMatches > positiveMatches) {
      return Sentiment.NEGATIVE;
    }

    if (positiveMatches > negativeMatches) {
      return Sentiment.POSITIVE;
    }

    return Sentiment.NEUTRAL;
  }

  /**
   * Calculates confidence for a lexicon-based text analysis result.
   *
   * @param totalMatches Total lexicon matches.
   * @param positiveMatches Number of positive matches.
   * @param negativeMatches Number of negative matches.
   * @param relevanceConfidence Confidence from domain relevance filtering.
   * @returns Confidence score between 0 and 1.
   */
  private calculateConfidence(
    totalMatches: number,
    positiveMatches: number,
    negativeMatches: number,
    relevanceConfidence: number,
  ): number {
    if (totalMatches === 0) {
      return Number(Math.max(relevanceConfidence * 0.5, 0.1).toFixed(3));
    }

    const matchConfidence = Math.min(totalMatches / 6, 1);

    const sentimentStrength = Math.min(
      Math.abs(positiveMatches - negativeMatches) / 3,
      1,
    );

    const confidence =
      matchConfidence * 0.6 +
      sentimentStrength * 0.2 +
      relevanceConfidence * 0.2;

    return Number(Math.min(confidence, 1).toFixed(3));
  }

  /**
   * Builds an empty lexicon grouping object containing all lexicon types.
   *
   * @returns Empty lexicon groups.
   */
  private buildEmptyLexicons(): Record<NlpLexiconType, string[]> {
    return Object.values(NlpLexiconType).reduce(
      (accumulator, type) => ({
        ...accumulator,
        [type]: [],
      }),
      {} as Record<NlpLexiconType, string[]>,
    );
  }
}
