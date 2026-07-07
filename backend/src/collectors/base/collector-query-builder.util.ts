/**
 * Utility responsible for building search queries for collectors.
 *
 * @author Malak
 */
export class CollectorQueryBuilderUtil {
  static buildProblemQueries(
    domainKeywords: string[],
    problemWords: string[] = [],
  ): string[] {
    const defaultProblemWords = [
      'problem',
      'issue',
      'difficulty',
      'challenge',
      'complaint',
      'feedback',
      'review',
      'need',
      'struggle',
      'hard',
      'failed',
      'cannot',
      "can't",
      'help',
      'improve',
    ];

    const selectedProblemWords = problemWords.length
      ? problemWords
      : defaultProblemWords;

    return domainKeywords.flatMap((keyword) =>
      selectedProblemWords.map((problemWord) => `${keyword} ${problemWord}`),
    );
  }
}