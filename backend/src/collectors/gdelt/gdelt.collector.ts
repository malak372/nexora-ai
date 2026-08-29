import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';

import { BaseCollector } from '../base/base.collector';
import type { SocialCollector } from '../base/collector.interface';
import type { CollectorInput, CollectorPost } from '../base/collector.types';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';
import { CollectorAbortContextUtil } from '../base/collector-abort-context.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';
import { RequestEvidenceAlignmentUtil } from '../../ideas/generation/utils/request-evidence-alignment.util';

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
  private static readonly TLS_CERTIFICATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  private static runtimeUnavailableReason: string | null = null;

  constructor(configService: ConfigService) {
    super(configService, GdeltCollector.name);
  }

  isRuntimeAvailable(): boolean {
    return GdeltCollector.transientCircuitOpenUntil <= Date.now();
  }

  getRuntimeUnavailableReason(): string | null {
    return this.isRuntimeAvailable()
      ? null
      : GdeltCollector.runtimeUnavailableReason ??
          'GDELT transient failure circuit is currently open.';
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    if (!this.isRuntimeAvailable()) {
      this.logger.debug(
        'GDELT collection skipped because the transient timeout circuit is open.',
      );
      return [];
    }

    const queryBudget = input.collectionMode === 'TARGETED_RECOVERY' ? 1 : 3;
    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    }).slice(0, queryBudget);

    if (queries.length === 0) return [];

    const settled = await Promise.allSettled(
      queries.map((query) =>
        this.isRuntimeAvailable()
          ? this.search(query, input)
          : Promise.resolve<GdeltArticle[]>([]),
      ),
    );
    const articles = settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );

    const seen = new Set<string>();
    return articles
      .filter((article) => Boolean(article.url && article.title))
      .filter((article) => this.passesRequestIdentityGate(article, input))
      .filter((article) => {
        const key = article.url?.trim() ?? '';
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.resolveMaxSavedPosts(input))
      .map((article) => this.mapArticle(article, input));
  }

  private passesRequestIdentityGate(
    article: GdeltArticle,
    input: CollectorInput,
  ): boolean {
    const request = this.cleanNormalizedText(input.requestDescription);
    if (!request) return true;
    const title = this.cleanPlainText(article.title);
    if (!title) return false;

    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: request,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries,
    });
    if ([
      'PUBLIC_PROGRAM_COST_ATTRIBUTION',
      'OPERATIONAL_COST_ATTRIBUTION',
      'HEALTHCARE_SUPPLY_COST_EFFICIENCY',
      'AGRICULTURE_DISTRIBUTION_PROFITABILITY',
      'AGRICULTURE_EXPORT_PROFITABILITY',
    ].includes(constraint.kind)) {
      return RequestEvidenceAlignmentUtil.classifyForRequest({
        requestDescription: request,
        evidenceText: title,
        plannedQueries: input.plannedQueries ?? [],
      }) !== 'UNRELATED';
    }
    return true;
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
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 3_200 : 3_500,
        signal: CollectorAbortContextUtil.getSignal(),
      });

      GdeltCollector.consecutiveTransientFailures = 0;
      GdeltCollector.runtimeUnavailableReason = null;
      return Array.isArray(response.data?.articles)
        ? [...response.data.articles]
        : [];
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const certificateFailure =
        /certificate has expired|cert_has_expired|unable to verify the first certificate|self signed certificate/iu.test(
          errorMessage,
        );
      const transient =
        axios.isAxiosError(error) &&
        (!error.response ||
          error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' ||
          (error.response.status >= 500 && error.response.status <= 599));
      if (certificateFailure) {
        GdeltCollector.transientCircuitOpenUntil = Math.max(
          GdeltCollector.transientCircuitOpenUntil,
          Date.now() + GdeltCollector.TLS_CERTIFICATE_COOLDOWN_MS,
        );
        GdeltCollector.runtimeUnavailableReason =
          'GDELT TLS certificate validation failed; collector is cooling down rather than bypassing certificate verification.';
      } else if (transient) {
        GdeltCollector.consecutiveTransientFailures += 1;
        if (GdeltCollector.consecutiveTransientFailures >= 2) {
          GdeltCollector.transientCircuitOpenUntil = Math.max(
            GdeltCollector.transientCircuitOpenUntil,
            Date.now() + GdeltCollector.TRANSIENT_COOLDOWN_MS,
          );
          GdeltCollector.runtimeUnavailableReason =
            'GDELT transient network failure circuit is currently open.';
        }
      }

      this.logger.debug(
        `GDELT query failed non-fatally. query="${query}" error=${errorMessage}`,
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
