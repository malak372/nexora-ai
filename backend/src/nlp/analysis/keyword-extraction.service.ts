import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { STOP_WORDS } from '../common/constants/stop-words.constant';
import { WeightedKeyword } from '../pipeline/types/intelligent-analysis.types';
import { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

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
 * - Count each keyword once per text to prevent spammy repetition.
 * - Give higher weight to lexicon terms that represent problems, needs,
 *   complaints, opportunities, and feature requests.
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
  private readonly lexiconTermWeight = 2;
  private readonly phraseWeight = 2;

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
      const phrases = this.extractPhrases(tokens);
      const lexiconTerms = this.extractPriorityLexiconTerms(text);

      this.addUniqueTerms(frequencyMap, tokens, 1);
      this.addUniqueTerms(frequencyMap, phrases, this.phraseWeight);
      this.addUniqueTerms(frequencyMap, lexiconTerms, this.lexiconTermWeight);
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
   * @returns Meaningful single-word tokens.
   */
  private extractTokens(cleanedText: string, stopWords: string[]): string[] {
    const stopWordSet = new Set(stopWords.map((word) => word.toLowerCase()));

    return cleanedText
      .split(/\s+/)
      .map((token) => token.toLowerCase().trim())
      .filter((token) => this.isValidToken(token, stopWordSet));
  }

  /**
   * Extracts meaningful two-word phrases from valid tokens.
   *
   * Phrases such as "waiting time", "online appointment", and
   * "customer service" are often more useful for project idea generation
   * than isolated words.
   *
   * @param tokens Valid normalized tokens.
   * @returns Two-word phrase candidates.
   */
  private extractPhrases(tokens: string[]): string[] {
    const phrases: string[] = [];

    for (let index = 0; index < tokens.length - 1; index += 1) {
      phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
    }

    return phrases;
  }

  /**
   * Extracts important lexicon terms that should receive higher weight.
   *
   * Problem, need, complaint, urgency, cost, time, accessibility, safety,
   * reliability, opportunity, and feature-request terms directly support
   * Nexora AI idea generation requirements.
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

    return priorityTypes
      .flatMap((type) => text.matchedLexicons[type] ?? [])
      .map((term) => term.toLowerCase().trim())
      .filter(Boolean);
  }

  /**
   * Adds terms to the global frequency map once per analyzed text.
   *
   * Counting each term once per text prevents a single repeated comment from
   * dominating keyword frequency while still preserving dataset-level trends.
   *
   * @param frequencyMap Global keyword frequency map.
   * @param terms Terms extracted from a single text.
   * @param weight Frequency weight assigned to each unique term.
   */
  private addUniqueTerms(
    frequencyMap: Map<string, number>,
    terms: string[],
    weight: number,
  ): void {
    const uniqueTerms = new Set(
      terms.map((term) => term.toLowerCase().trim()).filter(Boolean),
    );

    for (const term of uniqueTerms) {
      frequencyMap.set(term, (frequencyMap.get(term) ?? 0) + weight);
    }
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
