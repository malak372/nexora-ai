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

      if (!normalizedTerm) continue;

      if (title.includes(normalizedTerm)) score += 30;
      if (body.includes(normalizedTerm)) score += 12;
    }

    /**
     * Problem / need relevance.
     *
     * These terms help prioritize content that may describe
     * real problems, requests, complaints, or unmet needs.
     */
    for (const term of input.problemTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) continue;

      if (title.includes(normalizedTerm)) score += 35;
      if (body.includes(normalizedTerm)) score += 15;
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
   * Normalizes text before matching.
   *
   * @param text Raw text.
   * @returns Lowercase trimmed text with normalized whitespace.
   */
  private static normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}