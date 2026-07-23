import { LanguageCode } from '@prisma/client';

/**
 * Maximum average word count required for the text-length component
 * to reach its maximum normalized complexity score.
 *
 * Community posts and comments with an average of forty words or more
 * are treated as sufficiently long to potentially require deeper analysis.
 *
 * This value is used as a normalization target. It does not mean that
 * every text containing forty or more words is automatically complex.
 *
 * @author Eman
 */
export const COMPLEX_TEXT_WORD_TARGET = 40;

/**
 * Text-confidence values below this threshold are considered weak
 * rule-based analysis results.
 *
 * Confidence values must be normalized between 0 and 1.
 *
 */
export const LOW_TEXT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Minimum number of detected topics required for a text to be
 * classified as a multi-topic text.
 *
 */
export const MULTI_TOPIC_MINIMUM_COUNT = 2;

/**
 * Weights used to calculate the final normalized text-complexity score.
 *
 * Each value represents the contribution of one complexity factor.
 * The sum of all configured weights must equal 1.
 *
 */
export const TEXT_COMPLEXITY_WEIGHTS = {
  averageTextLength: 0.15,
  negationRatio: 0.15,
  contrastRatio: 0.15,
  mixedSentimentRatio: 0.15,
  lowConfidenceRatio: 0.15,
  multiTopicRatio: 0.1,
  unmatchedLexiconRatio: 0.15,
} as const;

/**
 * Strongly typed representation of the configured
 * text-complexity weights.
 *
 */
export type TextComplexityWeights = typeof TEXT_COMPLEXITY_WEIGHTS;

/**
 * Token sequence representing one linguistic expression.
 *
 * A signal may contain one token, such as:
 * - not
 * - لا
 *
 * Or multiple tokens, such as:
 * - do not
 * - even though
 *
 */
export type LinguisticSignal = readonly string[];

/**
 * Immutable collection of linguistic expressions.
 *
 */
export type LinguisticSignalCollection = readonly LinguisticSignal[];

/**
 * Language codes that have dedicated linguistic-signal collections.
 *
 * LanguageCode.ANY is excluded because it represents a request to use
 * all configured language collections.
 *
 */
export type SpecificLanguageCode = Exclude<
  LanguageCode,
  typeof LanguageCode.ANY
>;

/**
 * Negation expressions grouped by their supported language.
 *
 * Grouping expressions by language reduces false matches and avoids
 * evaluating irrelevant language rules when the analyzed language is known.
 *
 */
export const NEGATION_SIGNALS_BY_LANGUAGE = {
  [LanguageCode.EN]: [
    ['not'],
    ['no'],
    ['never'],
    ['neither'],
    ['nor'],
    ['cannot'],
    ['can', 'not'],
    ['do', 'not'],
    ['does', 'not'],
    ['did', 'not'],
    ['is', 'not'],
    ['are', 'not'],
    ['was', 'not'],
    ['were', 'not'],
  ],

  [LanguageCode.AR]: [
    ['ليس'],
    ['ليست'],
    ['لا'],
    ['لم'],
    ['لن'],
    ['ما'],
    ['غير'],
    ['بدون'],
  ],

  [LanguageCode.FR]: [['pas'], ['ne'], ['jamais'], ['aucun']],

  [LanguageCode.ES]: [['no'], ['sin'], ['nunca']],

  [LanguageCode.DE]: [['nicht'], ['kein'], ['keine'], ['nie']],

  [LanguageCode.TR]: [['değil'], ['yok'], ['hayır']],
} as const satisfies Record<SpecificLanguageCode, LinguisticSignalCollection>;

/**
 * Contrast expressions grouped by their supported language.
 *
 * Contrast signals may indicate mixed, conditional, or
 * context-dependent meaning.
 *
 */
export const CONTRAST_SIGNALS_BY_LANGUAGE = {
  [LanguageCode.EN]: [
    ['but'],
    ['however'],
    ['although'],
    ['though'],
    ['yet'],
    ['despite'],
    ['even', 'though'],
    ['on', 'the', 'other', 'hand'],
  ],

  [LanguageCode.AR]: [
    ['لكن'],
    ['ولكن'],
    ['رغم'],
    ['بالرغم'],
    ['مع', 'ذلك'],
    ['إلا', 'أن'],
  ],

  [LanguageCode.FR]: [['mais'], ['cependant'], ['pourtant'], ['bien', 'que']],

  [LanguageCode.ES]: [['pero'], ['aunque'], ['sin', 'embargo']],

  [LanguageCode.DE]: [['aber'], ['jedoch'], ['obwohl'], ['trotzdem']],

  [LanguageCode.TR]: [['ama'], ['ancak'], ['fakat'], ['rağmen']],
} as const satisfies Record<SpecificLanguageCode, LinguisticSignalCollection>;

/**
 * All configured negation expressions.
 *
 * This collection is used when the requested analysis language is ANY.
 *
 */
export const ALL_NEGATION_SIGNALS: LinguisticSignalCollection = Object.values(
  NEGATION_SIGNALS_BY_LANGUAGE,
).flat();

/**
 * All configured contrast expressions.
 *
 * This collection is used when the requested analysis language is ANY.
 *
 */
export const ALL_CONTRAST_SIGNALS: LinguisticSignalCollection = Object.values(
  CONTRAST_SIGNALS_BY_LANGUAGE,
).flat();
