import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
export class TopicRuleService implements OnModuleInit {
  private readonly cache = new Map<
    LanguageCode,
    { readonly expiresAt: number; readonly rules: TopicRule[] }
  >();

  private readonly inFlight = new Map<LanguageCode, Promise<TopicRule[]>>();

  private readonly cacheTtlMs = 10 * 60 * 1000;
  private readonly logger = new Logger(TopicRuleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prefetches the rules most generation runs need while Nest is finishing its
   * startup sequence. This removes two cold Supabase reads from the first NLP
   * analysis without delaying application readiness.
   */
  onModuleInit(): void {
    void Promise.allSettled([
      this.getRules(LanguageCode.EN),
      this.getRules(LanguageCode.ANY),
    ]).then((results) => {
      const rejected = results.filter(
        (result) => result.status === 'rejected',
      ).length;

      if (rejected > 0) {
        this.logger.warn(
          `NLP topic-rule warmup completed with ${rejected} failed request(s); normal lazy loading remains available.`,
        );
      }
    });
  }

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
    const now = Date.now();
    const cached = this.cache.get(language);

    if (cached && cached.expiresAt > now) {
      return this.cloneRules(cached.rules);
    }

    const existingRequest = this.inFlight.get(language);
    if (existingRequest) {
      return this.cloneRules(await existingRequest);
    }

    const request = this.loadRules(language);
    this.inFlight.set(language, request);

    try {
      const rules = await request;
      this.cache.set(language, {
        rules,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return this.cloneRules(rules);
    } finally {
      this.inFlight.delete(language);
    }
  }

  private async loadRules(language: LanguageCode): Promise<TopicRule[]> {
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

  private cloneRules(rules: readonly TopicRule[]): TopicRule[] {
    return rules.map((rule) => ({
      topic: rule.topic,
      terms: [...rule.terms],
    }));
  }

  /**
   * Normalizes topic rule keywords.
   *
   * @param terms Raw keyword collection.
   * @returns Unique normalized keywords.
   */
  private normalizeTerms(terms: unknown): readonly string[] {
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