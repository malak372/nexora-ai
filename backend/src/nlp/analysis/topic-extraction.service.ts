import { Injectable } from '@nestjs/common';

import {
    WeightedKeyword,
    WeightedTopic,
} from '../pipeline/types/intelligent-analysis.types';

type TopicRule = {
    topic: string;
    terms: string[];
};

/**
 * Extracts high-level discussion topics from weighted keywords.
 *
 * This service converts frequent keywords into broader topic groups that help
 * Nexora AI understand the main areas of community concern before prompt
 * generation.
 *
 * Responsibilities:
 * - Group related keywords into meaningful discussion topics.
 * - Calculate topic frequency from supporting keyword frequencies.
 * - Keep unmatched but frequent keywords as standalone topic candidates.
 * - Return sorted weighted topics for insight extraction and prompt building.
 *
 * This service is intentionally rule-based and does not call external AI
 * services. AI-assisted topic refinement can be added later when rule-based
 * confidence is low.
 *
 * @author Eman
 */
@Injectable()
export class TopicExtractionService {
    private readonly maxTopics = 15;

    private readonly topicRules: TopicRule[] = [
        {
            topic: 'Appointment Management',
            terms: ['appointment', 'booking', 'reservation', 'schedule', 'scheduling'],
        },
        {
            topic: 'Waiting Time',
            terms: ['waiting', 'wait', 'queue', 'delay', 'delayed', 'slow'],
        },
        {
            topic: 'Service Quality',
            terms: ['service', 'quality', 'support', 'response', 'experience'],
        },
        {
            topic: 'Cost and Affordability',
            terms: ['cost', 'price', 'expensive', 'payment', 'fee', 'affordable'],
        },
        {
            topic: 'Access and Availability',
            terms: ['access', 'available', 'availability', 'unavailable', 'open'],
        },
        {
            topic: 'Reliability and Performance',
            terms: ['reliable', 'reliability', 'crash', 'error', 'bug', 'broken'],
        },
        {
            topic: 'Safety and Trust',
            terms: ['safe', 'safety', 'risk', 'privacy', 'trust', 'secure'],
        },
        {
            topic: 'Communication',
            terms: ['message', 'notification', 'call', 'contact', 'reply', 'update'],
        },
        {
            topic: 'Healthcare Services',
            terms: ['doctor', 'clinic', 'hospital', 'patient', 'medicine', 'pharmacy'],
        },
        {
            topic: 'Digital Access',
            terms: ['app', 'website', 'online', 'platform', 'system', 'portal'],
        },
    ];

    /**
     * Extracts the most relevant discussion topics from weighted keywords.
     *
     * @param keywords Weighted keywords extracted from analyzed community texts.
     * @returns Weighted topics sorted by frequency.
     */
    extract(keywords: WeightedKeyword[]): WeightedTopic[] {
        const topicMap = new Map<string, number>();

        for (const keyword of keywords) {
            const normalizedKeyword = this.normalizeTerm(keyword.keyword);
            const topic = this.findMatchingTopic(normalizedKeyword);

            topicMap.set(topic, (topicMap.get(topic) ?? 0) + keyword.frequency);
        }

        return [...topicMap.entries()]
            .map(([topic, frequency]) => ({
                topic,
                frequency,
            }))
            .sort((first, second) => {
                if (second.frequency !== first.frequency) {
                    return second.frequency - first.frequency;
                }

                return first.topic.localeCompare(second.topic);
            })
            .slice(0, this.maxTopics);
    }

    /**
     * Finds the best topic label for a normalized keyword.
     *
     * If no configured rule matches the keyword, the keyword itself is converted
     * into a readable standalone topic. This preserves important emerging signals
     * that are not yet covered by predefined rules.
     *
     * @param keyword Normalized keyword.
     * @returns Topic label.
     */
    private findMatchingTopic(keyword: string): string {
        const matchedRule = this.topicRules.find((rule) =>
            rule.terms.some((term) => this.isRelatedTerm(keyword, term)),
        );

        return matchedRule?.topic ?? this.toTitleCase(keyword);
    }

    /**
     * Checks whether a keyword is related to a configured topic term.
     *
     * This supports both exact matches and phrase matches, which allows keywords
     * such as "waiting time" or "online appointment" to match their broader
     * topic groups.
     *
     * @param keyword Normalized keyword.
     * @param term Topic rule term.
     * @returns True when the keyword is related to the topic term.
     */
    private isRelatedTerm(keyword: string, term: string): boolean {
        return keyword === term || keyword.includes(term) || term.includes(keyword);
    }

    /**
     * Normalizes a keyword before topic matching.
     *
     * @param value Keyword value.
     * @returns Normalized keyword.
     */
    private normalizeTerm(value: string): string {
        return value.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Converts unmatched keyword candidates into readable topic labels.
     *
     * @param value Normalized keyword.
     * @returns Title-cased topic label.
     */
    private toTitleCase(value: string): string {
        return value
            .split(' ')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}