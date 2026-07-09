import { Injectable } from '@nestjs/common';

/**
 * Normalizes problem-related terms into consistent recurring problem titles.
 *
 * This service prevents semantically similar problem signals from being stored
 * as separate recurring problems. For example, terms such as "waiting",
 * "delay", and "queue" can be grouped under a single readable problem title.
 *
 * Responsibilities:
 * - Normalize raw problem terms.
 * - Group common related terms into stable problem categories.
 * - Convert unmatched terms into readable problem titles.
 *
 * This service does not calculate severity, extract evidence, persist data,
 * or call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class ProblemNormalizerService {
    private readonly problemGroups: Record<string, string[]> = {
        'Waiting Time': ['waiting', 'wait', 'queue', 'delay', 'delayed', 'slow'],
        'Appointment Difficulty': [
            'appointment',
            'booking',
            'reservation',
            'schedule',
            'scheduling',
        ],
        'High Cost': ['cost', 'price', 'expensive', 'fee', 'payment'],
        'Limited Accessibility': [
            'access',
            'available',
            'availability',
            'unavailable',
            'disabled',
        ],
        'Reliability Issues': [
            'reliable',
            'reliability',
            'crash',
            'error',
            'bug',
            'broken',
            'failure',
        ],
        'Safety Concerns': ['safe', 'safety', 'risk', 'danger', 'privacy', 'secure'],
        'Poor Communication': [
            'message',
            'notification',
            'call',
            'contact',
            'reply',
            'update',
        ],
    };

    /**
     * Converts a raw problem term into a normalized recurring problem title.
     *
     * @param term Raw problem-related term extracted from lexicon matches.
     * @returns Normalized recurring problem title.
     */
    normalize(term: string): string {
        const normalizedTerm = this.normalizeTerm(term);

        if (!normalizedTerm) {
            return '';
        }

        const matchedGroup = Object.entries(this.problemGroups).find(([, terms]) =>
            terms.some((groupTerm) => this.isRelatedTerm(normalizedTerm, groupTerm)),
        );

        return matchedGroup?.[0] ?? this.toTitleCase(normalizedTerm);
    }

    /**
     * Checks whether a normalized term is related to a configured group term.
     *
     * @param term Normalized problem term.
     * @param groupTerm Configured group term.
     * @returns True when both terms are related.
     */
    private isRelatedTerm(term: string, groupTerm: string): boolean {
        return (
            term === groupTerm ||
            term.includes(groupTerm) ||
            groupTerm.includes(term)
        );
    }

    /**
     * Normalizes a raw term before grouping.
     *
     * @param term Raw problem-related term.
     * @returns Normalized lowercase term.
     */
    private normalizeTerm(term: string): string {
        return term.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Converts unmatched problem terms into readable titles.
     *
     * @param value Normalized problem term.
     * @returns Title-cased problem title.
     */
    private toTitleCase(value: string): string {
        return value
            .split(' ')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}