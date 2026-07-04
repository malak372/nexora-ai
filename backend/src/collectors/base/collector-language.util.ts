/**
 * Utility class responsible for language normalization
 * and lightweight language detection used by data collectors.
 *
 * Features:
 * - Converts user-provided language names into standardized ISO language codes.
 * - Performs simple content-language validation using character detection.
 * - Helps collectors filter posts and comments according to the requested language.
 *
 * Note:
 * This utility uses lightweight heuristic detection (regular expressions)
 * rather than full natural language detection libraries in order to remain
 * fast and dependency-free.
 *
 * @author Malak
 */
export class CollectorLanguageUtil {
  /**
   * Resolves a language name or code into a normalized ISO language code.
   *
   * Supported values:
   * - English → en
   * - Arabic → ar
   * - French → fr
   * - Turkish → tr
   *
   * Examples:
   * - "English" → "en"
   * - "EN" → "en"
   * - "arabic" → "ar"
   * - "fr" → "fr"
   *
   * Returns undefined if the language is not recognized.
   *
   * @param language User-provided language name or code.
   * @returns Normalized ISO language code or undefined.
   */
  static resolveLanguageCode(language?: string): string | undefined {
    if (!language) return undefined;

    const value = language.trim().toLowerCase();

    const map: Record<string, string> = {
      en: 'en',
      english: 'en',
      ar: 'ar',
      arabic: 'ar',
      fr: 'fr',
      french: 'fr',
      tr: 'tr',
      turkish: 'tr',
    };

    return map[value];
  }

  /**
   * Determines whether a text appears to match
   * the requested language.
   *
   * Detection strategy:
   * - Arabic: checks for Arabic Unicode characters.
   * - English: checks for Latin alphabet characters.
   * - Other supported languages currently bypass filtering.
   * - If no language is requested, all content is accepted.
   *
   * This method is intentionally lightweight and is not intended
   * to replace full language detection algorithms.
   *
   * @param content Text to evaluate.
   * @param language Requested language name or code.
   * @returns True if the content matches the requested language.
   */
  static matchesRequestedLanguage(
    content: string,
    language?: string,
  ): boolean {
    const languageCode = this.resolveLanguageCode(language);

    if (!languageCode) return true;
    if (languageCode === 'ar') return /[\u0600-\u06FF]/.test(content);
    if (languageCode === 'en') return /[a-z]/i.test(content);

    return true;
  }
}