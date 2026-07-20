import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { STOP_WORDS } from '../common/constants/stop-words.constant';

import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type { WeightedKeyword } from '../pipeline/types/intelligent-analysis.types';

/**
 * Minimum number of characters required for a token to qualify
 * as a meaningful keyword.
 */
const MINIMUM_KEYWORD_TOKEN_LENGTH = 3;

/**
 * Maximum number of weighted keywords returned by the extraction service.
 */
const MAX_EXTRACTED_KEYWORDS = 30;

/**
 * Weight assigned to a normal single-word token.
 */
const SINGLE_TOKEN_WEIGHT = 1;

/**
 * Additional importance assigned to meaningful two-word phrases.
 */
const PHRASE_WEIGHT = 2;

/**
 * Importance assigned to terms matched by high-value NLP lexicons.
 */
const PRIORITY_LEXICON_TERM_WEIGHT = 2;

/**
 * Lexicon categories that directly contribute to software-project
 * opportunity and requirement discovery.
 *
 * These terms receive a higher keyword score because they represent
 * stronger problem, need, risk, or opportunity signals.
 */
const PRIORITY_LEXICON_TYPES = [
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
] as const satisfies readonly NlpLexiconType[];

/**
 * Extracts weighted keywords from lexicon-analyzed community texts.
 *
 * This service identifies meaningful terms and short phrases from cleaned
 * social posts and comments after preprocessing and lexicon analysis.
 *
 * Responsibilities:
 * - Tokenize cleaned community texts.
 * - Remove language-specific stop words.
 * - Extract meaningful single-word keywords.
 * - Extract important two-word phrases.
 * - Count each term once per text for each extraction category.
 * - Give higher weight to important lexicon terms.
 * - Return deterministically sorted weighted keywords.
 *
 * This service does not:
 * - Persist extracted keywords.
 * - Call external AI providers.
 * - Modify the supplied analysis records.
 *
 * @author Eman
 */
@Injectable()
export class KeywordExtractionService {
  /**
   * Extracts the most relevant weighted keywords from analyzed texts.
   *
   * Each term is counted at most once per analyzed text within each
   * extraction category. A term may receive combined weight when it is
   * detected as both a normal token and an important lexicon signal.
   *
   * @param analyzedTexts Lexicon-enriched text-analysis results.
   * @returns Weighted keywords sorted by descending score and then alphabetically.
   */
  extract(
    analyzedTexts: readonly LexiconTextAnalysisResult[],
  ): WeightedKeyword[] {
    const weightedFrequencyMap = new Map<string, number>();

    for (const text of analyzedTexts) {
      const stopWords = STOP_WORDS[text.language] ?? [];

      const tokens = this.extractTokens(text.cleanedText, stopWords);
      const phrases = this.extractPhrases(tokens);
      const priorityLexiconTerms =
        this.extractPriorityLexiconTerms(text);

      this.addUniqueTerms(
        weightedFrequencyMap,
        tokens,
        SINGLE_TOKEN_WEIGHT,
      );

      this.addUniqueTerms(
        weightedFrequencyMap,
        phrases,
        PHRASE_WEIGHT,
      );

      this.addUniqueTerms(
        weightedFrequencyMap,
        priorityLexiconTerms,
        PRIORITY_LEXICON_TERM_WEIGHT,
      );
    }

    return [...weightedFrequencyMap.entries()]
      .map(([keyword, frequency]) => ({
        keyword,
        frequency,
      }))
      .sort(
        (first, second) =>
          second.frequency - first.frequency ||
          first.keyword.localeCompare(second.keyword),
      )
      .slice(0, MAX_EXTRACTED_KEYWORDS);
  }

  /**
   * Extracts normalized meaningful tokens from cleaned text.
   *
   * @param cleanedText Cleaned text produced by preprocessing.
   * @param stopWords Language-specific stop words.
   * @returns Meaningful normalized single-word tokens.
   */
  private extractTokens(
    cleanedText: string,
    stopWords: readonly string[],
  ): string[] {
    const normalizedStopWords = new Set(
      stopWords
        .map((word) => this.normalizeTerm(word))
        .filter(Boolean),
    );

    return cleanedText
      .split(/\s+/u)
      .map((token) => this.normalizeTerm(token))
      .filter((token) => this.isValidToken(token, normalizedStopWords));
  }

  /**
   * Extracts consecutive two-word phrases from valid tokens.
   *
   * Phrases such as:
   * - "waiting time"
   * - "online appointment"
   * - "customer service"
   *
   * often provide more useful semantic context than isolated words.
   *
   * @param tokens Valid normalized tokens.
   * @returns Consecutive two-word phrase candidates.
   */
  private extractPhrases(tokens: readonly string[]): string[] {
    const phrases: string[] = [];

    for (let index = 0; index < tokens.length - 1; index += 1) {
      const currentToken = tokens[index];
      const nextToken = tokens[index + 1];

      if (!currentToken || !nextToken) {
        continue;
      }

      phrases.push(`${currentToken} ${nextToken}`);
    }

    return phrases;
  }

  /**
   * Extracts lexicon terms that represent high-value problem,
   * requirement, risk, and opportunity signals.
   *
   * @param text Lexicon-enriched text-analysis result.
   * @returns Normalized priority lexicon terms.
   */
  private extractPriorityLexiconTerms(
    text: LexiconTextAnalysisResult,
  ): string[] {
    return PRIORITY_LEXICON_TYPES
      .flatMap((type) => text.matchedLexicons[type] ?? [])
      .map((term) => this.normalizeTerm(term))
      .filter(Boolean);
  }

  /**
   * Adds each normalized term once to the global weighted-frequency map
   * for the current analyzed text and extraction category.
   *
   * This prevents repeated occurrences inside one text from dominating
   * the dataset-level keyword ranking.
   *
   * @param frequencyMap Global weighted keyword-frequency map.
   * @param terms Terms extracted from one analyzed text.
   * @param weight Score assigned to each unique term.
   */
  private addUniqueTerms(
    frequencyMap: Map<string, number>,
    terms: readonly string[],
    weight: number,
  ): void {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error('Keyword weight must be a finite positive number.');
    }

    const uniqueTerms = new Set(
      terms
        .map((term) => this.normalizeTerm(term))
        .filter(Boolean),
    );

    for (const term of uniqueTerms) {
      frequencyMap.set(
        term,
        (frequencyMap.get(term) ?? 0) + weight,
      );
    }
  }

  /**
   * Determines whether a token qualifies as a meaningful keyword.
   *
   * @param token Normalized token.
   * @param stopWords Normalized language-specific stop words.
   * @returns True when the token is meaningful.
   */
  private isValidToken(
    token: string,
    stopWords: ReadonlySet<string>,
  ): boolean {
    if (!token) {
      return false;
    }

    if (token.length < MINIMUM_KEYWORD_TOKEN_LENGTH) {
      return false;
    }

    if (stopWords.has(token)) {
      return false;
    }

    if (/^\p{N}+$/u.test(token)) {
      return false;
    }

    return true;
  }

  /**
   * Normalizes a keyword or phrase for consistent aggregation.
   *
   * The normalization:
   * - Converts text to lowercase.
   * - Removes leading and trailing punctuation.
   * - Replaces repeated whitespace with one space.
   * - Removes surrounding whitespace.
   *
   * @param value Raw term or phrase.
   * @returns Normalized term.
   */
  private normalizeTerm(value: string): string {
    return value
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}