import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import {
  WeightedKeyword,
  WeightedTopic,
} from '../pipeline/types/intelligent-analysis.types';
import {
  TopicRule,
  TopicRuleService,
} from '../topic-rules/topic-rule.service';

/**
 * Maximum number of extracted topics returned by the service.
 */
const MAX_EXTRACTED_TOPICS = 15;

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
  constructor(private readonly topicRuleService: TopicRuleService) { }

  /**
   * Extracts the most relevant discussion topics from weighted keywords.
   *
   * @param keywords Weighted keywords extracted from analyzed community texts.
   * @param language Language used to load matching topic rules.
   * @returns Weighted topics sorted by frequency.
   */
  async extract(
    keywords: readonly WeightedKeyword[],
    language: LanguageCode,
  ): Promise<WeightedTopic[]> {
    if (keywords.length === 0) {
      return [];
    }

    const topicRules = await this.topicRuleService.getRules(language);
    const topicFrequencyMap = new Map<string, number>();

    for (const keyword of keywords) {
      const normalizedKeyword = this.normalizeTerm(keyword.keyword);

      if (!normalizedKeyword || keyword.frequency <= 0) {
        continue;
      }

      const topic = this.findMatchingTopic(normalizedKeyword, topicRules);
      const currentFrequency = topicFrequencyMap.get(topic) ?? 0;

      topicFrequencyMap.set(
        topic,
        currentFrequency + keyword.frequency,
      );
    }

    return Array.from(topicFrequencyMap, ([topic, frequency]) => ({
      topic,
      frequency,
    }))
      .sort((first, second) => {
        const frequencyDifference = second.frequency - first.frequency;

        if (frequencyDifference !== 0) {
          return frequencyDifference;
        }

        return first.topic.localeCompare(second.topic);
      })
      .slice(0, MAX_EXTRACTED_TOPICS);
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
  private findMatchingTopic(
    keyword: string,
    topicRules: readonly TopicRule[],
  ): string {
    const matchedRule = topicRules.find((rule) =>
      rule.terms.some((term) =>
        this.isRelatedTerm(keyword, this.normalizeTerm(term)),
      ),
    );

    return matchedRule?.topic.trim() || this.toTitleCase(keyword);
  }

  /**
   * Checks whether a keyword is related to a configured topic term.
   *
   * Supports:
   * - Exact matches.
   * - A keyword containing a complete configured phrase.
   * - A configured phrase containing the complete keyword.
   *
   * Word boundaries are respected to avoid partial matches such as
   * "car" incorrectly matching "scarcity".
   *
   * @param keyword Normalized keyword.
   * @param term Normalized topic-rule term.
   * @returns True when the keyword is related to the topic term.
   */
  private isRelatedTerm(keyword: string, term: string): boolean {
    if (!keyword || !term) {
      return false;
    }

    if (keyword === term) {
      return true;
    }

    const keywordWords = keyword.split(' ');
    const termWords = term.split(' ');

    return (
      this.containsConsecutiveWords(keywordWords, termWords) ||
      this.containsConsecutiveWords(termWords, keywordWords)
    );
  }

  /**
   * Checks whether one word sequence contains another consecutive sequence.
   *
   * @param sourceWords Words being searched.
   * @param candidateWords Consecutive words to locate.
   * @returns True when the candidate sequence exists in the source sequence.
   */
  private containsConsecutiveWords(
    sourceWords: readonly string[],
    candidateWords: readonly string[],
  ): boolean {
    if (
      candidateWords.length === 0 ||
      candidateWords.length > sourceWords.length
    ) {
      return false;
    }

    const finalStartIndex = sourceWords.length - candidateWords.length;

    for (let startIndex = 0; startIndex <= finalStartIndex; startIndex += 1) {
      const matches = candidateWords.every(
        (candidateWord, offset) =>
          sourceWords[startIndex + offset] === candidateWord,
      );

      if (matches) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalizes a keyword or topic-rule term before matching.
   *
   * @param value Value to normalize.
   * @returns Lowercase value with normalized whitespace.
   */
  private normalizeTerm(value: string): string {
    return value.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Converts unmatched keyword candidates into readable topic labels.
   *
   * Languages without letter casing, such as Arabic, remain unchanged.
   *
   * @param value Normalized keyword.
   * @returns Readable topic label.
   */
  private toTitleCase(value: string): string {
    return value
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
      .join(' ');
  }
}