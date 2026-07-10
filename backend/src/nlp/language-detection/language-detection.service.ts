import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

const LANGUAGE_PATTERNS: Partial<Record<LanguageCode, RegExp>> = {
  [LanguageCode.AR]: /[\u0600-\u06FF]/,
  [LanguageCode.TR]: /[çğıöşü]/i,
  [LanguageCode.FR]: /[àâæçéèêëîïôœùûüÿ]/i,
  [LanguageCode.ES]: /[áéíóúñü¿¡]/i,
  [LanguageCode.DE]: /[äöüß]/i,
  [LanguageCode.EN]: /[a-z]/i,
};

/**
 * Service responsible for detecting the language of cleaned texts
 * before running deeper NLP analysis.
 *
 * Uses a lightweight rule-based approach based on Unicode character
 * ranges and common language-specific characters.
 *
 * @author Eman
 */
@Injectable()
export class LanguageDetectionService {
  /**
   * Detects the most likely language of a single cleaned text.
   *
   * @param text Cleaned text from the preprocessing step.
   * @returns Detected language code, or ANY when language is mixed or unknown.
   */
  detect(text: string): LanguageCode {
    const normalizedText = text?.trim() ?? '';

    if (!normalizedText) {
      return LanguageCode.ANY;
    }

    const matchedLanguages = Object.entries(LANGUAGE_PATTERNS)
      .filter(([, pattern]) => pattern.test(normalizedText))
      .map(([language]) => language as LanguageCode);

    if (matchedLanguages.length !== 1) {
      return LanguageCode.ANY;
    }

    return matchedLanguages[0];
  }

  /**
   * Detects languages for multiple cleaned texts.
   *
   * @param texts Cleaned texts.
   * @returns Detected language code for each text.
   */
  detectMany(texts: string[]): LanguageCode[] {
    return texts.map((text) => this.detect(text));
  }
}
