import { Injectable } from '@nestjs/common';

/**
 * Result returned after checking whether a cleaned text is related
 * to the selected project domain.
 *
 * @author Eman
 */
export type DomainRelevanceResult = {
  /**
   * Indicates whether the text should continue through the NLP pipeline.
   */
  readonly isRelevant: boolean;

  /**
   * Relevance score between 0 and 1 based on matched domain terms.
   */
  readonly score: number;

  /**
   * Confidence level between 0 and 1 used for ranking and filtering.
   */
  readonly confidence: number;

  /**
   * Single-word keywords matched in the text.
   */
  readonly matchedKeywords: readonly string[];

  /**
   * Multi-word domain phrases matched in the text.
   */
  readonly matchedPhrases: readonly string[];
};

/**
 * Filters cleaned social posts and comments by checking whether they are
 * related to the selected project domain.
 *
 * This service acts as an early gate in the NLP pipeline. It prevents
 * unrelated collected content from affecting sentiment statistics,
 * keyword extraction, recurring-problem detection, user-needs extraction,
 * and final prompt generation.
 *
 * The service is deterministic, stateless, and rule-based. It uses:
 * - Domain keywords loaded by the caller.
 * - Optional user-provided keywords.
 * - Exact token-aware keyword matching.
 * - Multi-word phrase matching.
 * - Unicode-aware text normalization.
 * - A normalized relevance score and confidence value.
 *
 * The service does not:
 * - Query Prisma directly.
 * - Persist analysis results.
 * - Call external AI providers.
 * - Perform stemming or semantic similarity matching.
 *
 * @author Eman
 */
@Injectable()
export class DomainRelevanceService {
  /**
   * Minimum number of matched domain terms required for a text
   * to be considered relevant.
   */
  private static readonly MINIMUM_MATCHED_TERMS = 1;

  /**
   * Number of independent matches required to reach the maximum
   * base confidence before applying the phrase-match boost.
   */
  private static readonly MATCHES_FOR_MAXIMUM_CONFIDENCE = 3;

  /**
   * Additional confidence granted when at least one multi-word
   * domain phrase is matched.
   */
  private static readonly PHRASE_CONFIDENCE_BOOST = 0.2;

  /**
   * Checks whether a cleaned text is relevant to the selected domain.
   *
   * When no usable domain keywords are available, the text is treated as
   * relevant. This fail-open behavior prevents valid collected data from
   * being discarded because of incomplete domain-keyword configuration.
   *
   * @param text Cleaned text produced by the preprocessing stage.
   * @param keywords Domain keywords and optional user-provided keywords.
   * @returns Relevance result containing matched terms and normalized metrics.
   */
  analyze(
    text: string,
    keywords: readonly string[],
  ): DomainRelevanceResult {
    const normalizedText = this.normalizeText(text);
    const normalizedKeywords = this.normalizeKeywords(keywords);

    if (normalizedKeywords.length === 0) {
      return this.buildResult({
        isRelevant: true,
        score: 0,
        confidence: 0,
        matchedKeywords: [],
        matchedPhrases: [],
      });
    }

    if (!normalizedText) {
      return this.buildResult({
        isRelevant: false,
        score: 0,
        confidence: 0,
        matchedKeywords: [],
        matchedPhrases: [],
      });
    }

    const matchedKeywords: string[] = [];
    const matchedPhrases: string[] = [];

    for (const keyword of normalizedKeywords) {
      if (!this.containsTerm(normalizedText, keyword)) {
        continue;
      }

      if (this.isPhrase(keyword)) {
        matchedPhrases.push(keyword);
      } else {
        matchedKeywords.push(keyword);
      }
    }

    const totalMatches = matchedKeywords.length + matchedPhrases.length;

    return this.buildResult({
      isRelevant:
        totalMatches >= DomainRelevanceService.MINIMUM_MATCHED_TERMS,
      score: this.calculateScore(totalMatches, normalizedKeywords.length),
      confidence: this.calculateConfidence(
        totalMatches,
        matchedPhrases.length,
      ),
      matchedKeywords,
      matchedPhrases,
    });
  }

  /**
   * Filters cleaned text objects and keeps only domain-relevant items.
   *
   * The original objects are preserved without mutation.
   *
   * @param texts Cleaned text objects.
   * @param keywords Domain keywords and optional user-provided keywords.
   * @returns A new array containing only domain-relevant items.
   */
  filterRelevant<T extends Readonly<{ cleanedText: string }>>(
    texts: readonly T[],
    keywords: readonly string[],
  ): T[] {
    return texts.filter(
      (item) => this.analyze(item.cleanedText, keywords).isRelevant,
    );
  }

  /**
   * Normalizes text before exact term matching.
   *
   * NFKC normalization standardizes compatible Unicode forms, while
   * zero-width characters are removed to prevent invisible characters
   * from breaking valid keyword and phrase matches.
   *
   * @param value Raw text or keyword.
   * @returns Normalized lowercase text with collapsed whitespace.
   */
  private normalizeText(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/gu, ' ');
  }

  /**
   * Normalizes, removes empty values, and deduplicates domain keywords.
   *
   * @param keywords Raw domain and user-provided keywords.
   * @returns Unique normalized keywords.
   */
  private normalizeKeywords(keywords: readonly string[]): string[] {
    if (!Array.isArray(keywords)) {
      return [];
    }

    return [
      ...new Set(
        keywords
          .map((keyword) => this.normalizeText(keyword))
          .filter((keyword) => keyword.length > 0),
      ),
    ];
  }

  /**
   * Checks whether a complete keyword or phrase exists in normalized text.
   *
   * Unicode letter and number boundaries are used instead of whitespace-only
   * boundaries. This allows matching beside punctuation such as:
   * - software,
   * - application.
   * - التطبيق،
   * - النظام.
   *
   * It also prevents partial matches inside larger words.
   *
   * @param text Normalized text.
   * @param term Normalized keyword or phrase.
   * @returns True when the complete term occurs in the text.
   */
  private containsTerm(text: string, term: string): boolean {
    const escapedTerm = this.escapeRegExp(term);

    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{M}\\p{N}])${escapedTerm}(?=$|[^\\p{L}\\p{M}\\p{N}])`,
      'u',
    );

    return pattern.test(text);
  }

  /**
   * Escapes characters that have special meaning inside a regular expression.
   *
   * @param value Literal value to escape.
   * @returns Regular-expression-safe value.
   */
  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Determines whether a normalized domain term contains multiple tokens.
   *
   * @param keyword Normalized keyword.
   * @returns True when the term is a multi-word phrase.
   */
  private isPhrase(keyword: string): boolean {
    return keyword.includes(' ');
  }

  /**
   * Calculates the proportion of configured domain terms matched in the text.
   *
   * @param totalMatches Number of matched domain terms.
   * @param totalKeywords Number of configured normalized domain terms.
   * @returns Normalized relevance score between 0 and 1.
   */
  private calculateScore(
    totalMatches: number,
    totalKeywords: number,
  ): number {
    if (totalKeywords <= 0) {
      return 0;
    }

    return this.round(this.clamp(totalMatches / totalKeywords));
  }

  /**
   * Calculates confidence from the number and type of matched terms.
   *
   * Multiple independent matches increase confidence. Matching at least one
   * domain phrase applies a small boost because phrases are generally more
   * specific than isolated keywords.
   *
   * @param totalMatches Number of matched domain terms.
   * @param matchedPhrasesCount Number of matched multi-word phrases.
   * @returns Normalized confidence between 0 and 1.
   */
  private calculateConfidence(
    totalMatches: number,
    matchedPhrasesCount: number,
  ): number {
    if (totalMatches <= 0) {
      return 0;
    }

    const baseConfidence = Math.min(
      totalMatches /
      DomainRelevanceService.MATCHES_FOR_MAXIMUM_CONFIDENCE,
      1,
    );

    const phraseBoost =
      matchedPhrasesCount > 0
        ? DomainRelevanceService.PHRASE_CONFIDENCE_BOOST
        : 0;

    return this.round(this.clamp(baseConfidence + phraseBoost));
  }

  /**
   * Creates an immutable domain-relevance result.
   *
   * Defensive array copies prevent callers from mutating the service's
   * internal result construction state.
   *
   * @param input Result properties.
   * @returns Completed domain-relevance result.
   */
  private buildResult(input: {
    readonly isRelevant: boolean;
    readonly score: number;
    readonly confidence: number;
    readonly matchedKeywords: readonly string[];
    readonly matchedPhrases: readonly string[];
  }): DomainRelevanceResult {
    return {
      isRelevant: input.isRelevant,
      score: this.round(this.clamp(input.score)),
      confidence: this.round(this.clamp(input.confidence)),
      matchedKeywords: [...input.matchedKeywords],
      matchedPhrases: [...input.matchedPhrases],
    };
  }

  /**
   * Restricts a numeric value to the normalized range from 0 to 1.
   *
   * @param value Value to normalize.
   * @returns Value clamped between 0 and 1.
   */
  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Rounds a numeric value to three decimal places.
   *
   * @param value Value to round.
   * @returns Value rounded to three decimal places.
   */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}