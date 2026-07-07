/**
 * Utility class responsible for language normalization
 * and lightweight language detection used by data collectors.
 *
 * Features:
 * - Converts language names into ISO language codes.
 * - Supports all project languages.
 * - Provides NewsAPI language resolution.
 * - Performs lightweight language detection.
 *
 * @author Malak
 */
export class CollectorLanguageUtil {
  /**
   * Language aliases.
   */
  private static readonly LANGUAGE_MAP: Record<string, string> = {
    en: 'en',
    eng: 'en',
    english: 'en',

    ar: 'ar',
    ara: 'ar',
    arabic: 'ar',

    fr: 'fr',
    fra: 'fr',
    french: 'fr',

    tr: 'tr',
    tur: 'tr',
    turkish: 'tr',

    de: 'de',
    deu: 'de',
    ger: 'de',
    german: 'de',

    es: 'es',
    spa: 'es',
    spanish: 'es',

    ru: 'ru',
    rus: 'ru',
    russian: 'ru',

    it: 'it',
    ita: 'it',
    italian: 'it',

    nl: 'nl',
    nld: 'nl',
    dutch: 'nl',

    pt: 'pt',
    por: 'pt',
    portuguese: 'pt',

    he: 'he',
    heb: 'he',
    hebrew: 'he',

    no: 'no',
    nor: 'no',
    norwegian: 'no',

    sv: 'sv',
    swe: 'sv',
    swedish: 'sv',

    zh: 'zh',
    zho: 'zh',
    chi: 'zh',
    chinese: 'zh',
  };

  /**
   * Languages officially supported by NewsAPI.
   */
  private static readonly NEWS_API_LANGUAGES = new Set([
    'ar',
    'de',
    'en',
    'es',
    'fr',
    'he',
    'it',
    'nl',
    'no',
    'pt',
    'ru',
    'sv',
    'zh',
  ]);

  /**
   * Resolves a language name or code into an ISO language code.
   *
   * Examples:
   * English -> en
   * Arabic -> ar
   * German -> de
   */
  static resolveLanguageCode(language?: string): string | undefined {
    if (!language) return undefined;

    const value = language.trim().toLowerCase();

    return (
      this.LANGUAGE_MAP[value] ??
      this.LANGUAGE_MAP[value.slice(0, 3)] ??
      value.slice(0, 2)
    );
  }

  /**
   * Resolves language code supported by NewsAPI.
   *
   * Returns undefined if NewsAPI does not support it.
   */
  static resolveNewsApiLanguage(
    language?: string,
  ): string | undefined {
    const code = this.resolveLanguageCode(language);

    if (!code) {
      return undefined;
    }

    return this.NEWS_API_LANGUAGES.has(code)
      ? code
      : undefined;
  }

  /**
   * Returns true if the requested language is Arabic.
   */
  static isArabic(language?: string): boolean {
    return this.resolveLanguageCode(language) === 'ar';
  }

  /**
   * Performs lightweight language validation.
   */
  static matchesRequestedLanguage(
    content: string,
    language?: string,
  ): boolean {
    const languageCode = this.resolveLanguageCode(language);

    if (!languageCode) {
      return true;
    }

    switch (languageCode) {
      case 'ar':
        return /[\u0600-\u06FF]/.test(content);

      case 'en':
        return /[a-z]/i.test(content);

      case 'de':
        return /[äöüß]/i.test(content) || /[a-z]/i.test(content);

      case 'fr':
        return /[àâçéèêëîïôûùüÿ]/i.test(content) || /[a-z]/i.test(content);

      case 'es':
        return /[áéíóúñü]/i.test(content) || /[a-z]/i.test(content);

      case 'it':
        return /[àèéìîòóù]/i.test(content) || /[a-z]/i.test(content);

      case 'nl':
      case 'pt':
      case 'sv':
      case 'no':
      case 'tr':
      case 'ru':
      case 'he':
      case 'zh':
      default:
        return true;
    }
  }
}