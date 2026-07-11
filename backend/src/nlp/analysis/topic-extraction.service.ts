import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import {
  WeightedKeyword,
  WeightedTopic,
} from '../pipeline/types/intelligent-analysis.types';
import { TopicRule, TopicRuleService } from '../topic-rules/topic-rule.service';

/**
 * Extracts high-level discussion topics from weighted keywords.
 *
 * This service converts frequent keywords into broader topic groups using
 * configurable topic rules stored in the database. This allows Nexora AI to
 * classify community concerns without hardcoding domain-specific rules inside
 * the application source code.
 *
 * Responsibilities:
 * - Load configurable topic rules for the analyzed language.
 * - Group related keywords into meaningful discussion topics.
 * - Calculate topic frequency from supporting keyword frequencies.
 * - Keep unmatched but frequent keywords as standalone topic candidates.
 * - Return sorted weighted topics for insight extraction and prompt building.
 *
 * This service does not persist results and does not call external AI services.
 * AI-assisted topic refinement can be added later when rule-based confidence
 * is low.
 *
 * @author Eman
 */
@Injectable()
export class TopicExtractionService {
  private readonly maxTopics = 15;

  constructor(private readonly topicRuleService: TopicRuleService) {}

  /**
   * Extracts the most relevant discussion topics from weighted keywords.
   *
   * @param keywords Weighted keywords extracted from analyzed community texts.
   * @param language Language used to load matching topic rules.
   * @returns Weighted topics sorted by frequency.
   */
  async extract(
    keywords: WeightedKeyword[],
    language: LanguageCode,
  ): Promise<WeightedTopic[]> {
    const topicRules = await this.topicRuleService.getRules(language);
    const topicMap = new Map<string, number>();

    for (const keyword of keywords) {
      const normalizedKeyword = this.normalizeTerm(keyword.keyword);

      if (!normalizedKeyword) {
        continue;
      }

      const topic = this.findMatchingTopic(normalizedKeyword, topicRules);

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
   * into a readable standalone topic. This preserves emerging signals that are
   * not yet covered by administrator-managed topic rules.
   *
   * @param keyword Normalized keyword.
   * @param topicRules Configurable topic rules loaded from the database.
   * @returns Topic label.
   */
  private findMatchingTopic(keyword: string, topicRules: TopicRule[]): string {
    const matchedRule = topicRules.find((rule) =>
      rule.terms.some((term) => this.isRelatedTerm(keyword, term)),
    );

    return matchedRule?.topic ?? this.toTitleCase(keyword);
  }

  /**
   * Checks whether a keyword is related to a configured topic term.
   *
   * This supports exact matches and phrase matches, which allows keywords such
   * as "waiting time" or "online appointment" to match broader topic groups.
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
