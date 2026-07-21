import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Represents one configurable topic rule used by the NLP engine.
 */
export type TopicRule = {
  /**
   * High-level topic name.
   */
  topic: string;

  /**
   * Keywords associated with the topic.
   */
  terms: readonly string[];
};

/**
 * Provides read access to configurable NLP topic rules stored in the database.
 *
 * Topic rules are used by the TopicExtractionService to group related
 * community keywords into broader discussion topics before AI prompt
 * generation.
 *
 * Keeping topic rules in the database allows administrators to extend,
 * customize, * and fine-tune topic classification without modifying the
 * application source code.
 *
 * This service is responsible only for data retrieval and normalization.
 * Topic matching logic belongs to TopicExtractionService.
 *
 * @author Eman
 */
@Injectable()
export class TopicRuleService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Returns all active topic rules for a specific language.
   *
   * The lookup includes:
   * - Language-specific topic rules.
   * - Generic topic rules marked as LanguageCode.ANY.
   *
   * @param language Target language.
   * @returns Normalized topic rules.
   */
  async getRules(language: LanguageCode): Promise<TopicRule[]> {
    const rules = await this.prisma.nlpTopicRule.findMany({
      where: {
        isActive: true,
        language: {
          in: [language, LanguageCode.ANY],
        },
      },
      select: {
        topic: true,
        terms: true,
      },
      orderBy: [
        {
          topic: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    return rules.map((rule) => ({
      topic: rule.topic.trim(),
      terms: this.normalizeTerms(rule.terms),
    }));
  }

  /**
   * Normalizes topic rule keywords.
   *
   * @param terms Raw keyword collection.
   * @returns Unique normalized keywords.
   */
  private normalizeTerms(
    terms: unknown,
  ): readonly string[] {
    if (!Array.isArray(terms)) {
      return [];
    }

    return [
      ...new Set(
        terms
          .filter((term): term is string => typeof term === 'string')
          .map((term) => term.toLowerCase().trim())
          .filter(Boolean),
      ),
    ];
  }
}