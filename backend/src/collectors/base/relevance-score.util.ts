/**
 * Shared relevance scoring utility.
 *
 * Used by collectors and the data collection pipeline
 * to rank and filter collected posts.
 *
 * @author Malak
 */
export class RelevanceScoreUtil {
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

    for (const term of input.domainTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) continue;

      score +=
        Math.min(this.countTermOccurrences(title, normalizedTerm), 3) * 35;

      score +=
        Math.min(this.countTermOccurrences(body, normalizedTerm), 5) * 15;
    }

    for (const term of input.problemTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) continue;

      score +=
        Math.min(this.countTermOccurrences(title, normalizedTerm), 3) * 25;

      score +=
        Math.min(this.countTermOccurrences(body, normalizedTerm), 5) * 10;
    }

    score += Math.min(input.likes ?? 0, 20);
    score += Math.min(input.replies ?? 0, 20);
    score += Math.min(input.shares ?? 0, 10);

    if (input.publishedAt) {
      const daysOld =
        (Date.now() - input.publishedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysOld <= 365) score += 10;
      else if (daysOld <= 1000) score += 5;
    }

    return score;
  }

  /**
   * Counts whole-word occurrences only.
   *
   * This prevents weak matches like:
   * - "class" inside "classification"
   * - "ai" inside unrelated words
   */
  private static countTermOccurrences(text: string, term: string): number {
    if (!text || !term) return 0;

    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');

    return text.match(regex)?.length ?? 0;
  }

  private static normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
