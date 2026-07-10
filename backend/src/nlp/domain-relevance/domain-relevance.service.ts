import { Injectable } from '@nestjs/common';

/**
 * Result returned after checking whether a cleaned text is related
 * to the selected project domain.
 */
export type DomainRelevanceResult = {
  /**
   * Indicates whether the text should continue through the NLP pipeline.
   */
  isRelevant: boolean;

  /**
   * Relevance score between 0 and 1 based on matched domain keywords.
   */
  score: number;

  /**
   * Confidence level between 0 and 1 used for ranking and filtering.
   */
  confidence: number;

  /**
   * Single-word keywords matched in the text.
   */
  matchedKeywords: string[];

  /**
   * Multi-word domain phrases matched in the text.
   */
  matchedPhrases: string[];
};

/**
 * Filters cleaned social posts and comments by checking whether they are
 * related to the selected domain.
 *
 * This service acts as an early gate in the NLP pipeline. It prevents
 * unrelated collected content from affecting sentiment statistics,
 * keyword extraction, recurring problem detection, user needs extraction,
 * and final prompt generation.
 *
 * The service is rule-based in the first version of the system and uses:
 * - Domain keywords from the database.
 * - Optional user-provided keywords.
 * - Exact keyword matching.
 * - Phrase matching for multi-word keywords.
 * - A normalized relevance score and confidence value.
 *
 * @author Eman
 */
@Injectable()
export class DomainRelevanceService {
  private readonly minimumMatchedTerms = 1;

  /**
   * Checks whether a cleaned text is relevant to the selected domain.
   *
   * When no domain keywords are available, the text is considered relevant
   * to avoid accidentally discarding collected data due to incomplete domain
   * configuration.
   *
   * @param text Cleaned text from the preprocessing step.
   * @param keywords Domain keywords and optional user keywords.
   * @returns Relevance result with score, confidence, and matched terms.
   */
  analyze(text: string, keywords: string[]): DomainRelevanceResult {
    const normalizedText = this.normalizeText(text);
    const normalizedKeywords = this.normalizeKeywords(keywords);

    if (!normalizedText || normalizedKeywords.length === 0) {
      return this.buildResult(true, 0, [], []);
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
    const score = this.calculateScore(totalMatches, normalizedKeywords.length);
    const confidence = this.calculateConfidence(
      totalMatches,
      matchedPhrases.length,
    );

    return this.buildResult(
      totalMatches >= this.minimumMatchedTerms,
      score,
      matchedKeywords,
      matchedPhrases,
      confidence,
    );
  }

  /**
   * Filters cleaned texts and keeps only domain-relevant items.
   *
   * @param texts Cleaned text objects.
   * @param keywords Domain keywords and optional user keywords.
   * @returns Texts that are relevant to the selected domain.
   */
  filterRelevant<T extends { cleanedText: string }>(
    texts: T[],
    keywords: string[],
  ): T[] {
    return texts.filter((item) => {
      const result = this.analyze(item.cleanedText, keywords);

      return result.isRelevant;
    });
  }

  private normalizeText(text: string): string {
    return text?.toLowerCase().trim().replace(/\s+/g, ' ') ?? '';
  }

  private normalizeKeywords(keywords: string[]): string[] {
    return [
      ...new Set(
        keywords
          .map((keyword) => this.normalizeText(keyword))
          .filter((keyword): keyword is string => Boolean(keyword)),
      ),
    ];
  }

  private containsTerm(text: string, term: string): boolean {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escapedTerm}(\\s|$)`, 'i');

    return pattern.test(text);
  }

  private isPhrase(keyword: string): boolean {
    return keyword.includes(' ');
  }

  private calculateScore(totalMatches: number, totalKeywords: number): number {
    if (totalKeywords === 0) {
      return 0;
    }

    return Number((totalMatches / totalKeywords).toFixed(3));
  }

  private calculateConfidence(
    totalMatches: number,
    matchedPhrasesCount: number,
  ): number {
    if (totalMatches === 0) {
      return 0;
    }

    const baseConfidence = Math.min(totalMatches / 3, 1);
    const phraseBoost = matchedPhrasesCount > 0 ? 0.2 : 0;

    return Number(Math.min(baseConfidence + phraseBoost, 1).toFixed(3));
  }

  private buildResult(
    isRelevant: boolean,
    score: number,
    matchedKeywords: string[],
    matchedPhrases: string[],
    confidence = 0,
  ): DomainRelevanceResult {
    return {
      isRelevant,
      score,
      confidence,
      matchedKeywords,
      matchedPhrases,
    };
  }
}
