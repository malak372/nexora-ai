/**
 * Shared relevance-scoring utility used by collectors
 * and the Data Collection orchestration layer.
 *
 * Matching is Unicode-aware so Arabic and other
 * non-Latin languages are handled correctly.
 *
 * @author Malak
 */
export class RelevanceScoreUtil {
  /**
   * Calculates a relevance score for one text record.
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

    /*
     * Domain-term relevance.
     */
    for (const term of input.domainTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) {
        continue;
      }

      score +=
        Math.min(this.countTermOccurrences(title, normalizedTerm), 3) * 35;

      score +=
        Math.min(this.countTermOccurrences(body, normalizedTerm), 5) * 15;
    }

    /*
     * Problem and need relevance.
     */
    for (const term of input.problemTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) {
        continue;
      }

      score +=
        Math.min(this.countTermOccurrences(title, normalizedTerm), 3) * 25;

      score +=
        Math.min(this.countTermOccurrences(body, normalizedTerm), 5) * 10;
    }

    /*
     * Engagement values are capped so popular but irrelevant
     * records do not dominate text relevance.
     */
    score += Math.min(Math.max(input.likes ?? 0, 0), 20);

    score += Math.min(Math.max(input.replies ?? 0, 0), 20);

    score += Math.min(Math.max(input.shares ?? 0, 0), 10);

    /*
     * Give a small bonus to recent content.
     */
    if (input.publishedAt) {
      const daysOld =
        (Date.now() - input.publishedAt.getTime()) / (1000 * 60 * 60 * 24);

      /*
       * A future invalid date should not receive
       * a recency bonus.
       */
      if (daysOld >= 0 && daysOld <= 365) {
        score += 10;
      } else if (daysOld > 365 && daysOld <= 1000) {
        score += 5;
      }
    }

    return score;
  }

  /**
   * Counts whole Unicode term occurrences.
   *
   * Unicode letter and number boundaries are used instead
   * of JavaScript \b because \b is unreliable for Arabic
   * and several other non-Latin scripts.
   */
  private static countTermOccurrences(text: string, term: string): number {
    if (!text || !term) {
      return 0;
    }

    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const expression = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapedTerm}(?![\\p{L}\\p{N}])`,
      'giu',
    );

    return text.match(expression)?.length ?? 0;
  }

  /**
   * Normalizes text consistently before matching.
   */
  private static normalize(text: string): string {
    return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
