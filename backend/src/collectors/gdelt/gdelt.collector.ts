import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';

import { BaseCollector } from '../base/base.collector';
import type { SocialCollector } from '../base/collector.interface';
import type { CollectorInput, CollectorPost } from '../base/collector.types';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';

/** Minimal fields returned by GDELT DOC 2.0 ArticleList JSON. */
type GdeltArticle = {
  readonly url?: string;
  readonly url_mobile?: string;
  readonly title?: string;
  readonly seendate?: string;
  readonly socialimage?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly sourcecountry?: string;
};

type GdeltDocResponse = {
  readonly articles?: readonly GdeltArticle[];
};

/**
 * No-auth GDELT DOC 2.0 collector.
 *
 * GDELT is used as a complementary public-news discovery lane. It requires no
 * API key and therefore remains available when commercial news quotas are
 * missing or exhausted. Headlines are still passed through the same central
 * relevance, request-alignment, provenance, and ranking gates as every other
 * evidence source.
 */
@Injectable()
export class GdeltCollector extends BaseCollector implements SocialCollector {
  readonly sourceKey = 'gdelt';

  private readonly apiUrl = 'https://api.gdeltproject.org/api/v2/doc/doc';
  private static transientCircuitOpenUntil = 0;
  private static consecutiveTransientFailures = 0;
  private static readonly TRANSIENT_COOLDOWN_MS = 45 * 1000;

  constructor(configService: ConfigService) {
    super(configService, GdeltCollector.name);
  }

  isRuntimeAvailable(): boolean {
    return GdeltCollector.transientCircuitOpenUntil <= Date.now();
  }

  getRuntimeUnavailableReason(): string | null {
    return this.isRuntimeAvailable()
      ? null
      : 'GDELT transient timeout circuit is currently open.';
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    if (!this.isRuntimeAvailable()) {
      this.logger.debug(
        'GDELT collection skipped because the transient timeout circuit is open.',
      );
      return [];
    }

    const queryBudget = input.collectionMode === 'TARGETED_RECOVERY' ? 1 : 2;
    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
    }).slice(0, queryBudget);

    if (queries.length === 0) return [];

    const articles: GdeltArticle[] = [];
    for (const query of queries) {
      if (!this.isRuntimeAvailable()) break;
      articles.push(...(await this.search(query, input)));
      if (articles.length >= 2) break;
    }

    const seen = new Set<string>();
    return articles
      .filter((article) => Boolean(article.url && article.title))
      .filter((article) => {
        const key = article.url?.trim() ?? '';
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.resolveMaxSavedPosts(input))
      .map((article) => this.mapArticle(article, input));
  }

  private async search(
    rawQuery: string,
    input: CollectorInput,
  ): Promise<GdeltArticle[]> {
    const query = rawQuery
      .replace(/\s+(?:OR|AND|NOT)\s+/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 9)
      .join(' ');
    if (!query) return [];

    try {
      const response = await axios.get<GdeltDocResponse>(this.apiUrl, {
        params: {
          query,
          mode: 'artlist',
          format: 'json',
          sort: 'HybridRel',
          maxrecords: Math.min(this.resolveMaxFetchedPosts(input), 25),
          timespan:
            input.collectionMode === 'TARGETED_RECOVERY' ? '3months' : '1month',
        },
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NexoraAI-Graduation-Project',
        },
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_100 : 1_900,
      });

      GdeltCollector.consecutiveTransientFailures = 0;
      return Array.isArray(response.data?.articles)
        ? [...response.data.articles]
        : [];
    } catch (error: unknown) {
      const transient =
        axios.isAxiosError(error) &&
        (!error.response ||
          error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' ||
          (error.response.status >= 500 && error.response.status <= 599));
      if (transient) {
        GdeltCollector.consecutiveTransientFailures += 1;
        if (GdeltCollector.consecutiveTransientFailures >= 2) {
          GdeltCollector.transientCircuitOpenUntil = Math.max(
            GdeltCollector.transientCircuitOpenUntil,
            Date.now() + GdeltCollector.TRANSIENT_COOLDOWN_MS,
          );
        }
      }

      this.logger.debug(
        `GDELT query failed non-fatally. query="${query}" error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private mapArticle(
    article: GdeltArticle,
    input: CollectorInput,
  ): CollectorPost {
    const url = article.url?.trim() ?? article.url_mobile?.trim() ?? '';
    const title = this.cleanPlainText(article.title);
    const sourceDomain = this.cleanPlainText(article.domain);

    return {
      externalId: this.stableId(url || title),
      title,
      content: title,
      author: sourceDomain || undefined,
      url: url || undefined,
      country: input.country,
      city: input.city,
      region: input.region,
      languageCode:
        this.cleanPlainText(article.language) ||
        this.resolveStoredLanguageCode(input.language),
      publishedAt: this.parseSeenDate(article.seendate),
      tags: [sourceDomain, this.cleanPlainText(article.sourcecountry)].filter(
        Boolean,
      ),
      comments: [],
    };
  }

  private stableId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }

  private parseSeenDate(value?: string): Date | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;

    const compact = normalized.match(
      /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/u,
    );
    if (compact) {
      const [, year, month, day, hour, minute, second] = compact;
      const parsed = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
      );
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
