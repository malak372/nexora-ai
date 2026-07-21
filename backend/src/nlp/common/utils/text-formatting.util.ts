/**
 * English words that normally remain lowercase in title case,
 * except when they appear as the first word.
 *
 */
const LOWERCASE_TITLE_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'the',
  'to',
  'up',
  'via',
  'with',
]);

/**
 * Converts normalized text into title case.
 *
 * This utility is used across the NLP engine to format extracted terms,
 * feature requests, problem titles, needs, and solution areas into readable
 * labels without duplicating formatting logic inside multiple services.
 *
 * Common English connector words (such as "of", "and", and "the") remain
 * lowercase unless they are the first word.
 *
 * @param value Raw or normalized text value.
 * @returns Title-cased text.
 *
 * @author Eman
 */
export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && LOWERCASE_TITLE_WORDS.has(word)) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
