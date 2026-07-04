/**
 * Shared utility for building problem-oriented
 * search queries.
 *
 * All collectors use the same logic.
 *
 * @author Malak
 */
export class CollectorQueryBuilderUtil {
  /**
   * Example:
   *
   * education
   * +
   * problems
   *
   * =>
   *
   * education problems
   */
  static buildProblemQueries(
    domainKeywords: string[],
    problemWords: string[],
  ): string[] {
    return Array.from(
      new Set(
        domainKeywords.flatMap((keyword) =>
          problemWords.map((problem) =>
            `${keyword} ${problem}`
              .trim()
              .toLowerCase(),
          ),
        ),
      ),
    );
  }
}