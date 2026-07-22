import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

/**
 * Language-detection result returned for a cleaned text.
 *
 * @author Eman
 */
export type LanguageDetectionResult = {
  /**
   * Most likely detected language.
   *
   * ANY is returned when the text is empty, mixed, unknown,
   * or when no language is sufficiently dominant.
   */
  readonly language: LanguageCode;

  /**
   * Normalized confidence between 0 and 1.
   */
  readonly confidence: number;

  /**
   * Languages that received a positive detection score.
   */
  readonly matchedLanguages: readonly LanguageCode[];
};

/**
 * Supported languages that can be detected explicitly.
 */
type DetectableLanguageCode = Exclude<LanguageCode, 'ANY'>;

/**
 * Common language markers used to improve detection when a text
 * does not contain language-specific characters.
 */
const LANGUAGE_COMMON_TERMS: Readonly<
  Record<DetectableLanguageCode, readonly string[]>
> = {
  [LanguageCode.AR]: [
    'في',
    'من',
    'على',
    'إلى',
    'عن',
    'هذا',
    'هذه',
    'هو',
    'هي',
    'كان',
    'كانت',
    'مع',
    'لكن',
    'أو',
    'و',
  ],
  [LanguageCode.EN]: [
    'the',
    'and',
    'is',
    'are',
    'was',
    'were',
    'to',
    'of',
    'in',
    'for',
    'with',
    'this',
    'that',
    'but',
    'or',
  ],
  [LanguageCode.FR]: [
    'le',
    'la',
    'les',
    'un',
    'une',
    'des',
    'de',
    'du',
    'et',
    'est',
    'dans',
    'pour',
    'avec',
    'mais',
    'ou',
  ],
  [LanguageCode.ES]: [
    'el',
    'la',
    'los',
    'las',
    'un',
    'una',
    'de',
    'del',
    'y',
    'es',
    'en',
    'para',
    'con',
    'pero',
    'o',
  ],
  [LanguageCode.DE]: [
    'der',
    'die',
    'das',
    'ein',
    'eine',
    'und',
    'ist',
    'in',
    'zu',
    'von',
    'mit',
    'für',
    'aber',
    'oder',
    'nicht',
  ],
  [LanguageCode.TR]: [
    've',
    'bir',
    'bu',
    'şu',
    'için',
    'ile',
    'ama',
    'veya',
    'de',
    'da',
    'mi',
    'mı',
    'çok',
    'olan',
    'olarak',
  ],
};

/**
 * Unicode-character patterns that provide strong evidence
 * for a specific language.
 */
const LANGUAGE_SPECIFIC_CHARACTER_PATTERNS: Readonly<
  Partial<Record<DetectableLanguageCode, RegExp>>
> = {
  [LanguageCode.AR]: /[\u0600-\u06FF]/gu,
  [LanguageCode.TR]: /[çğıöşü]/giu,
  [LanguageCode.FR]: /[àâæçéèêëîïôœùûüÿ]/giu,
  [LanguageCode.ES]: /[áéíóúñü¿¡]/giu,
  [LanguageCode.DE]: /[äöüß]/giu,
};

/**
 * Language score accumulated during detection.
 */
type LanguageScore = {
  readonly language: DetectableLanguageCode;
  readonly score: number;
};

/**
 * Detects the language of cleaned texts before language-aware NLP analysis.
 *
 * The detector uses a lightweight hybrid rule-based approach:
 * - Unicode script detection.
 * - Language-specific character detection.
 * - Common language-term matching.
 * - Dominance and confidence evaluation.
 *
 * The service is deterministic, stateless, does not query Prisma,
 * does not persist results, and does not call external AI providers.
 *
 * @author Eman
 */
@Injectable()
export class LanguageDetectionService {
  /**
   * Strong score granted when Arabic script characters are detected.
   */
  private static readonly SCRIPT_SCORE = 4;

  /**
   * Score granted for each language-specific character match.
   */
  private static readonly SPECIFIC_CHARACTER_SCORE = 1.5;

  /**
   * Score granted for each common language-term match.
   */
  private static readonly COMMON_TERM_SCORE = 1;

  /**
   * Minimum total score required before selecting a language.
   */
  private static readonly MINIMUM_LANGUAGE_SCORE = 2;

  /**
   * Minimum difference required between the highest and second-highest
   * scores to avoid classifying ambiguous or mixed text as one language.
   */
  private static readonly MINIMUM_SCORE_GAP = 1;

  /**
   * Detects the most likely language of a single cleaned text.
   *
   * @param text Cleaned text produced by the preprocessing stage.
   * @returns Full language-detection result.
   */
  detect(text: string): LanguageDetectionResult {
    const normalizedText = this.normalizeText(text);

    if (!normalizedText) {
      return this.buildResult(LanguageCode.ANY, 0, []);
    }

    const tokens = this.tokenize(normalizedText);
    const scores = this.calculateLanguageScores(normalizedText, tokens);
    const matchedLanguages = scores
      .filter((item) => item.score > 0)
      .map((item) => item.language);

    if (matchedLanguages.length === 0) {
      return this.buildResult(LanguageCode.ANY, 0, []);
    }

    const sortedScores = [...scores].sort(
      (first, second) => second.score - first.score,
    );

    const highest = sortedScores[0];
    const secondHighest = sortedScores[1];

    if (
      highest.score < LanguageDetectionService.MINIMUM_LANGUAGE_SCORE ||
      this.isAmbiguous(highest, secondHighest)
    ) {
      return this.buildResult(
        LanguageCode.ANY,
        this.calculateConfidence(highest.score, secondHighest?.score ?? 0),
        matchedLanguages,
      );
    }

    return this.buildResult(
      highest.language,
      this.calculateConfidence(highest.score, secondHighest?.score ?? 0),
      matchedLanguages,
    );
  }

  /**
   * Detects the most likely language code of a single cleaned text.
   *
   * This convenience method preserves simple call sites that only need
   * the final Prisma LanguageCode value.
   *
   * @param text Cleaned text.
   * @returns Detected language code.
   */
  detectCode(text: string): LanguageCode {
    return this.detect(text).language;
  }

  /**
   * Detects language results for multiple cleaned texts.
   *
   * @param texts Cleaned texts.
   * @returns Detection result for each text.
   */
  detectMany(texts: readonly string[]): LanguageDetectionResult[] {
    return texts.map((text) => this.detect(text));
  }

  /**
   * Detects only language codes for multiple cleaned texts.
   *
   * @param texts Cleaned texts.
   * @returns Detected language code for each text.
   */
  detectManyCodes(texts: readonly string[]): LanguageCode[] {
    return texts.map((text) => this.detectCode(text));
  }

  /**
   * Calculates detection scores for all supported languages.
   *
   * @param text Normalized text.
   * @param tokens Normalized text tokens.
   * @returns Language scores.
   */
  private calculateLanguageScores(
    text: string,
    tokens: readonly string[],
  ): LanguageScore[] {
    const tokenSet = new Set(tokens);

    return (Object.values(LanguageCode) as LanguageCode[])
      .filter(
        (language): language is DetectableLanguageCode =>
          language !== LanguageCode.ANY,
      )
      .map((language) => ({
        language,
        score:
          this.calculateScriptScore(text, language) +
          this.calculateSpecificCharacterScore(text, language) +
          this.calculateCommonTermScore(tokenSet, language),
      }));
  }

  /**
   * Calculates strong script-level evidence.
   *
   * Arabic receives a dedicated script score because Arabic characters
   * are distinct from the Latin alphabet used by the other supported languages.
   *
   * @param text Normalized text.
   * @param language Language being evaluated.
   * @returns Script score.
   */
  private calculateScriptScore(
    text: string,
    language: DetectableLanguageCode,
  ): number {
    if (language !== LanguageCode.AR) {
      return 0;
    }

    return /[\u0600-\u06FF]/u.test(text)
      ? LanguageDetectionService.SCRIPT_SCORE
      : 0;
  }

  /**
   * Calculates score from language-specific characters.
   *
   * @param text Normalized text.
   * @param language Language being evaluated.
   * @returns Specific-character score.
   */
  private calculateSpecificCharacterScore(
    text: string,
    language: DetectableLanguageCode,
  ): number {
    const pattern = LANGUAGE_SPECIFIC_CHARACTER_PATTERNS[language];

    if (!pattern) {
      return 0;
    }

    const matches = text.match(pattern);

    if (!matches) {
      return 0;
    }

    return matches.length * LanguageDetectionService.SPECIFIC_CHARACTER_SCORE;
  }

  /**
   * Calculates score from common language terms.
   *
   * @param tokens Unique normalized text tokens.
   * @param language Language being evaluated.
   * @returns Common-term score.
   */
  private calculateCommonTermScore(
    tokens: ReadonlySet<string>,
    language: DetectableLanguageCode,
  ): number {
    const matches = LANGUAGE_COMMON_TERMS[language].filter((term) =>
      tokens.has(term),
    ).length;

    return matches * LanguageDetectionService.COMMON_TERM_SCORE;
  }

  /**
   * Determines whether detection is too ambiguous to select one language.
   *
   * @param highest Highest language score.
   * @param secondHighest Second-highest language score.
   * @returns True when the score gap is too small.
   */
  private isAmbiguous(
    highest: LanguageScore,
    secondHighest?: LanguageScore,
  ): boolean {
    if (!secondHighest) {
      return false;
    }

    return (
      highest.score - secondHighest.score <
      LanguageDetectionService.MINIMUM_SCORE_GAP
    );
  }

  /**
   * Calculates normalized detection confidence.
   *
   * Confidence increases with both the strongest language score and
   * the margin separating it from the second-highest language.
   *
   * @param highestScore Highest language score.
   * @param secondHighestScore Second-highest language score.
   * @returns Confidence between 0 and 1.
   */
  private calculateConfidence(
    highestScore: number,
    secondHighestScore: number,
  ): number {
    if (highestScore <= 0) {
      return 0;
    }

    const dominance = (highestScore - secondHighestScore) / highestScore;
    const strength = Math.min(
      highestScore / (LanguageDetectionService.MINIMUM_LANGUAGE_SCORE * 2),
      1,
    );

    return this.round(this.clamp(dominance * 0.6 + strength * 0.4));
  }

  /**
   * Normalizes text before language detection.
   *
   * @param value Raw or cleaned text.
   * @returns Unicode-normalized lowercase text.
   */
  private normalizeText(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/gu, ' ');
  }

  /**
   * Converts normalized text into comparable language tokens.
   *
   * @param text Normalized text.
   * @returns Letter-based Unicode tokens.
   */
  private tokenize(text: string): string[] {
    return text.match(/\p{L}+/gu) ?? [];
  }

  /**
   * Creates an immutable language-detection result.
   *
   * @param language Selected language.
   * @param confidence Detection confidence.
   * @param matchedLanguages Languages with positive scores.
   * @returns Completed detection result.
   */
  private buildResult(
    language: LanguageCode,
    confidence: number,
    matchedLanguages: readonly LanguageCode[],
  ): LanguageDetectionResult {
    return {
      language,
      confidence: this.round(this.clamp(confidence)),
      matchedLanguages: [...matchedLanguages],
    };
  }

  /**
   * Restricts a numeric value to the normalized range from 0 to 1.
   *
   * @param value Value to normalize.
   * @returns Value clamped between 0 and 1.
   */
  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  /**
   * Rounds a numeric value to three decimal places.
   *
   * @param value Value to round.
   * @returns Value rounded to three decimal places.
   */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}
