/**
 * Maximum average word count required for the text-length component
 * to reach its maximum normalized complexity score.
 *
 * Community posts and comments with an average of forty words or more
 * are treated as sufficiently long to potentially require deeper analysis.
 *
 * @author Eman
 */
export const COMPLEX_TEXT_WORD_TARGET = 40;

/**
 * Text confidence values below this threshold are considered weak
 * rule-based analysis results.
 */
export const LOW_TEXT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Minimum number of detected topics required for a text to be
 * considered a multi-topic text.
 */
export const MULTI_TOPIC_MINIMUM_COUNT = 2;

/**
 * Weights used to calculate the final text-complexity score.
 *
 * The sum of all configured weights must equal 1.
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
 * Negation expressions supported by the rule-based complexity analyzer.
 *
 * Expressions are represented as token arrays to support both
 * single-word and multi-word signals without unsafe substring matching.
 */
export const NEGATION_SIGNALS: readonly (readonly string[])[] = [
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
    ['ليس'],
    ['ليست'],
    ['لا'],
    ['لم'],
    ['لن'],
    ['ما'],
    ['غير'],
    ['بدون'],
    ['pas'],
    ['ne'],
    ['jamais'],
    ['aucun'],
    ['sin'],
    ['no'],
    ['nunca'],
    ['nicht'],
    ['kein'],
    ['keine'],
    ['nie'],
    ['değil'],
    ['yok'],
    ['hayır'],
] as const;

/**
 * Contrast expressions indicating potentially mixed, conditional,
 * or context-dependent meaning.
 */
export const CONTRAST_SIGNALS: readonly (readonly string[])[] = [
    ['but'],
    ['however'],
    ['although'],
    ['though'],
    ['yet'],
    ['despite'],
    ['even', 'though'],
    ['on', 'the', 'other', 'hand'],
    ['لكن'],
    ['ولكن'],
    ['رغم'],
    ['بالرغم'],
    ['مع', 'ذلك'],
    ['إلا', 'أن'],
    ['mais'],
    ['cependant'],
    ['pourtant'],
    ['bien', 'que'],
    ['pero'],
    ['aunque'],
    ['sin', 'embargo'],
    ['aber'],
    ['jedoch'],
    ['obwohl'],
    ['trotzdem'],
    ['ama'],
    ['ancak'],
    ['fakat'],
    ['rağmen'],
] as const;