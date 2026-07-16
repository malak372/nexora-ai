/**
 * Utility responsible for language normalization and
 * lightweight script-based language validation.
 *
 * This utility is used only by external collectors.
 * Full language detection remains the responsibility
 * of the NLP pipeline.
 *
 * @author Malak
 */
export class CollectorLanguageUtil {
  /**
   * Supported language aliases mapped to ISO 639-1 codes.
   */
  private static readonly LANGUAGE_MAP: Readonly<Record<string, string>> = {
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
   * Languages accepted by NewsAPI.
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
   * Resolves a supported language name or alias
   * into an ISO 639-1 code.
   *
   * `ANY` means that no language restriction is requested,
   * therefore it resolves to undefined.
   *
   * Unknown strings are not silently truncated because
   * doing so could turn "ANY" into an invalid "an" code.
   */
  static resolveLanguageCode(language?: string): string | undefined {
    if (!language) {
      return undefined;
    }

    const value = language.trim().toLowerCase();

    if (!value || value === 'any') {
      return undefined;
    }

    const mapped =
      this.LANGUAGE_MAP[value] ?? this.LANGUAGE_MAP[value.slice(0, 3)];

    if (mapped) {
      return mapped;
    }

    /*
     * Accept a valid two-letter ISO-like code,
     * but reject arbitrary strings.
     */
    return /^[a-z]{2}$/i.test(value) ? value : undefined;
  }

  /**
   * Resolves a language supported by NewsAPI.
   */
  static resolveNewsApiLanguage(language?: string): string | undefined {
    const code = this.resolveLanguageCode(language);

    return code && this.NEWS_API_LANGUAGES.has(code) ? code : undefined;
  }

  /**
   * Returns true when Arabic was explicitly requested.
   */
  static isArabic(language?: string): boolean {
    return this.resolveLanguageCode(language) === 'ar';
  }

  /**
   * Performs lightweight script-based language validation.
   *
   * This function is deliberately conservative and is not
   * intended to replace the NLP language-detection service.
   */
  static matchesRequestedLanguage(content: string, language?: string): boolean {
    const code = this.resolveLanguageCode(language);

    /*
     * ANY or unknown language means no collector-side filter.
     */
    if (!code) {
      return true;
    }

    switch (code) {
      case 'ar':
        return /[\u0600-\u06FF]/u.test(content);

      case 'en':
        return /[a-z]/iu.test(content);

      case 'ru':
        return /[\u0400-\u04FF]/u.test(content);

      case 'he':
        return /[\u0590-\u05FF]/u.test(content);

      case 'zh':
        return /[\u3400-\u9FFF]/u.test(content);

      case 'de':
        return /[äöüßa-z]/iu.test(content);

      case 'fr':
        return /[àâçéèêëîïôûùüÿa-z]/iu.test(content);

      case 'es':
        return /[áéíóúñüa-z]/iu.test(content);

      case 'it':
        return /[àèéìîòóùa-z]/iu.test(content);

      /*
       * Lightweight script validation is not reliable
       * enough for these Latin-script languages.
       */
      case 'tr':
      case 'nl':
      case 'pt':
      case 'sv':
      case 'no':
      default:
        return true;
    }
  }
}
