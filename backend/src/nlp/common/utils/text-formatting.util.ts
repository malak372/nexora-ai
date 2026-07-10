/**
 * Converts normalized text into title case.
 *
 * This utility is used across the NLP engine to format extracted terms,
 * feature requests, problem titles, needs, and solution areas into readable
 * labels without duplicating formatting logic inside multiple services.
 *
 * @param value Raw or normalized text value.
 * @returns Title-cased text.
 */
export function toTitleCase(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}