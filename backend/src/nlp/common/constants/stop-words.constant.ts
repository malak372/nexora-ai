import { LanguageCode } from '@prisma/client';

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