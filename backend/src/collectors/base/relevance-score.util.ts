/**
 * Shared relevance scoring utility.
 *
 * Used by all collectors to rank collected posts before saving.
 *
 * The score is based on:
 * - Domain relevance.
 * - Problem / need signals.
 * - Engagement.
 * - Recency.
 * - Noise reduction for entertainment or unrelated content.
 *
 * @author Malak
 */
export class RelevanceScoreUtil {
  /**
   * Calculates a relevance score for a collected text item.
   *
   * Higher score means the content is more useful for the NLP pipeline
   * and more likely to represent a real user problem, need, or discussion.
   *
   * @param input Text, domain terms, problem terms, engagement, and date data.
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
    const text = `${title} ${body}`;

    let score = 0;

    /**
     * Domain relevance.
     */
    for (const term of input.domainTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) continue;

      if (title.includes(normalizedTerm)) score += 30;
      if (body.includes(normalizedTerm)) score += 12;
    }

    /**
     * Problem relevance from collector/base problem terms.
     */
    for (const term of input.problemTerms) {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) continue;

      if (title.includes(normalizedTerm)) score += 35;
      if (body.includes(normalizedTerm)) score += 15;
    }

    /**
     * Extra pain signals.
     *
     * These words usually indicate that the content contains
     * a real problem, complaint, unmet need, or user struggle.
     */
    const painSignals = [
      'problem',
      'issue',
      'struggle',
      'challenge',
      'difficult',
      'difficulty',
      'hard to',
      'need',
      'needs',
      'can’t',
      "can't",
      'cannot',
      'failed',
      'failure',
      'expensive',
      'costly',
      'debt',
      'stress',
      'confusing',
      'lack of',
      'missing',
      'broken',
      'error',
      'bug',
      'blocked',
      'delay',
      'waiting',
      'complaint',
      'request',
      'improve',
      'help',
    ];

    for (const signal of painSignals) {
      if (title.includes(signal)) score += 25;
      if (body.includes(signal)) score += 10;
    }

    /**
     * Noise signals.
     *
     * These words often indicate entertainment, music, or generic content
     * that may be less useful for software idea discovery.
     */
    const noiseSignals = [
      'song',
      'official video',
      'lyrics',
      'music',
      'vlog',
      'day in the life',
      'funny',
      'comedy',
      'reaction',
      'challenge video',
      'shorts',
      'trailer',
      'teaser',
      'dance',
      'prank',
    ];

    for (const signal of noiseSignals) {
      if (title.includes(signal)) score -= 40;
      if (body.includes(signal)) score -= 15;
    }

    /**
     * Strong discussion bonus.
     *
     * Content with real discussion is more useful for extracting
     * repeated problems and unmet needs.
     */
    if ((input.replies ?? 0) >= 5) score += 10;
    if ((input.replies ?? 0) >= 20) score += 15;

    /**
     * Engagement.
     */
    score += Math.min(input.likes ?? 0, 50);
    score += Math.min(input.replies ?? 0, 50);
    score += Math.min(input.shares ?? 0, 20);

    /**
     * Recency.
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

    /**
     * Empty or very weak content should not rank highly.
     */
    if (text.length < 40) {
      score -= 20;
    }

    return Math.max(score, 0);
  }

  /**
   * Normalizes text before matching.
   *
   * @param text Raw text.
   * @returns Lowercase trimmed text with normalized spaces.
   */
  private static normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}