import {
  MAX_NORMALIZED_IDEA_TITLE_LENGTH,
} from '../constants/ideas.constants';

/**
 * Normalizes an idea title for comparison and
 * duplicate detection.
 *
 * The original title must still be stored separately
 * for display purposes.
 *
 * Normalization steps:
 * - Unicode normalization.
 * - Lowercase conversion.
 * - Punctuation removal.
 * - Whitespace normalization.
 * - Maximum-length enforcement.
 */
export function normalizeIdeaTitle(
  title: string,
): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(
      0,
      MAX_NORMALIZED_IDEA_TITLE_LENGTH,
    );
}

/**
 * Compares two idea titles after normalization.
 */
export function areIdeaTitlesEquivalent(
  firstTitle: string,
  secondTitle: string,
): boolean {
  return (
    normalizeIdeaTitle(firstTitle) ===
    normalizeIdeaTitle(secondTitle)
  );
}

/**
 * Produces a compact title key that can be used by
 * application-level duplicate detection.
 *
 * This value is not a cryptographic hash.
 */
export function buildNormalizedIdeaTitleKey(
  title: string,
): string {
  return normalizeIdeaTitle(title)
    .replace(/\s+/g, '-');
}