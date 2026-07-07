import { LanguageCode } from '@prisma/client';

/**
 * Stop words dictionary used by the NLP pipeline.
 *
 * Stop words are common words that usually do not carry strong semantic
 * meaning during keyword extraction, topic detection, and recurring problem
 * analysis. Removing them helps the system focus on meaningful terms found
 * in community posts and comments.
 *
 * In Nexora AI, this dictionary supports multilingual data collection and NLP
 * analysis across the currently supported languages. The `ANY` language option
 * is intentionally kept empty because it represents an unknown or mixed-language
 * input where language-specific filtering should not be forced.
 *
 * Usage examples:
 * - Cleaning collected social posts before keyword extraction.
 * - Reducing noise in recurring problem detection.
 * - Improving generated prompt context quality before sending data to the AI.
 *
 * Notes:
 * - Keys must stay synchronized with the `LanguageCode` enum in Prisma.
 * - Add new language entries here whenever a new language is added to Prisma.
 * - Keep words lowercase to match normalized text processing.
 *
 * @author Eman
 */
export const STOP_WORDS: Record<LanguageCode, string[]> = {
    [LanguageCode.EN]: [
        'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on', 'for', 'with',
    ],

    [LanguageCode.AR]: [
        'في', 'من', 'على', 'إلى', 'عن', 'هذا', 'هذه', 'الذي', 'التي', 'كان',
    ],

    [LanguageCode.FR]: [
        'le', 'la', 'les', 'de', 'des', 'du', 'et', 'à', 'en', 'pour',
    ],

    [LanguageCode.ES]: [
        'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'para', 'con',
    ],

    [LanguageCode.DE]: [
        'der', 'die', 'das', 'und', 'ist', 'zu', 'mit', 'von', 'für', 'ein',
    ],

    [LanguageCode.TR]: [
        've', 'bir', 'bu', 'şu', 'ile', 'için', 'da', 'de', 'çok', 'olan',
    ],

    [LanguageCode.ANY]: [],
};