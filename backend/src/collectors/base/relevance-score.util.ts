/**
 * Shared relevance scoring utility.
 *
 * Used by all collectors to rank collected posts before saving.
 *
 * This utility stays generic and domain-neutral.
 * It does not penalize specific content types such as songs, vlogs,
 * or entertainment content because those may be valid results
 * depending on the selected domain.
 *
 * Score is based on:
 * - Domain relevance.
 * - Problem / need relevance.
 * - Engagement.
 * - Recency.
 *
 * @author Malak
 */
export class RelevanceScoreUtil {
  /**
   * Calculates a relevance score for a collected text item.
   *
   * Higher scores mean the content is more relevant to the selected domain
   * and more useful for later NLP analysis.
   *
   * @param input Text, ranking terms, engagement values, and publish date.
   * @returns Numeric relevance score.
   */
  static scoreText(input: {
    title?: string;
    body?: string;

    domainTerms: string[];
    problemTerms: string[];

    likes?: number;
    replies?: number;
    shares?: number;

    publishedAt?: Date;
  }): number {
    const title = this.normalize(input.title ?? '');
    const body = this.normalize(input.body ?? '');

    let score = 0;

    /**
     * Domain relevance.
     *
     * Title matches are weighted higher because the title usually
     * represents the main topic of the post.
     */
    for (const term of input.domainTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) {
        continue;
      }

      score +=
        Math.min(this.countTermOccurrences(title, normalizedTerm), 3) * 30;

      score +=
        Math.min(this.countTermOccurrences(body, normalizedTerm), 5) * 12;
    }

    /**
     * Problem / need relevance.
     *
     * These terms help prioritize content that may describe
     * real problems, requests, complaints, or unmet needs.
     */
    for (const term of input.problemTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) {
        continue;
      }

      score +=
        Math.min(this.countTermOccurrences(title, normalizedTerm), 3) * 35;

      score +=
        Math.min(this.countTermOccurrences(body, normalizedTerm), 5) * 15;
    }

    /**
     * Engagement.
     *
     * Engagement is capped so popular but weakly relevant content
     * does not dominate the ranking.
     */
    score += Math.min(input.likes ?? 0, 50);
    score += Math.min(input.replies ?? 0, 50);
    score += Math.min(input.shares ?? 0, 20);

    /**
     * Recency.
     *
     * Recent content receives a small bonus because it is usually
     * more useful for identifying current market or community needs.
     */
    if (input.publishedAt) {
      const daysOld =
        (Date.now() - input.publishedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysOld <= 365) {
        score += 15;
      } else if (daysOld <= 1000) {
        score += 8;
      }
    }

    return score;
  }

  /**
   * Counts how many times a search term appears in a text.
   *
   * The returned value is later capped inside the scoring logic
   * to prevent excessively repetitive content from receiving
   * an unfairly high relevance score.
   *
   * @param text Normalized text.
   * @param term Normalized search term.
   * @returns Number of occurrences.
   */
  private static countTermOccurrences(text: string, term: string): number {
    if (!text || !term) {
      return 0;
    }

    return text.split(term).length - 1;
  }

  /**
   * Normalizes text before matching.
   *
   * @param text Raw text.
   * @returns Lowercase trimmed text with normalized whitespace.
   */
  private static normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}