import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';

import { BaseCollector } from '../base/base.collector';
import type { SocialCollector } from '../base/collector.interface';
import type { CollectorInput, CollectorPost } from '../base/collector.types';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';

type CrossrefWork = {
  DOI?: string;
  URL?: string;
  title?: readonly string[];
  abstract?: string;
  publisher?: string;
  type?: string;
  published?: { 'date-parts'?: readonly (readonly number[])[] };
};

type CrossrefResponse = {
  message?: {
    items?: readonly CrossrefWork[];
  };
};

/**
 * Bounded no-auth scholarly metadata collector.
 *
 * Crossref is a complementary secondary-evidence lane for professional,
 * institutional, industrial, and research-heavy workflows where app-store
 * reviews are unlikely to contain the requested operational problem.
 */
@Injectable()
export class CrossrefCollector extends BaseCollector implements SocialCollector {
  readonly sourceKey = 'crossref';

  private readonly apiUrl = 'https://api.crossref.org/works';
  private static rateLimitCircuitOpenUntil = 0;
  private static readonly RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000;

  constructor(configService: ConfigService) {
    super(configService, CrossrefCollector.name);
  }

  isRuntimeAvailable(): boolean {
    return CrossrefCollector.rateLimitCircuitOpenUntil <= Date.now();
  }

  getRuntimeUnavailableReason(): string | null {
    return this.isRuntimeAvailable()
      ? null
      : 'Crossref temporary rate-limit circuit is currently open.';
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    if (!this.isRuntimeAvailable()) {
      this.logger.debug(
        'Crossref collection skipped because the temporary rate-limit circuit is open.',
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

    const works: CrossrefWork[] = [];
    for (const query of queries) {
      if (!this.isRuntimeAvailable()) break;
      works.push(...(await this.search(query, input)));
      if (works.length >= 2) break;
    }

    const seen = new Set<string>();
    return works
      .filter((work) => Boolean(this.titleOf(work)))
      .filter((work) => {
        const key = (work.DOI ?? work.URL ?? this.titleOf(work)).trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.resolveMaxSavedPosts(input))
      .map((work) => this.mapWork(work, input));
  }

  private async search(
    rawQuery: string,
    input: CollectorInput,
  ): Promise<CrossrefWork[]> {
    const query = rawQuery
      .replace(/\s+(?:OR|AND|NOT)\s+/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 8)
      .join(' ');
    if (!query) return [];

    try {
      const mailto = this.configService.get<string>('CROSSREF_MAILTO')?.trim();
      const response = await axios.get<CrossrefResponse>(this.apiUrl, {
        params: {
          'query.bibliographic': query,
          rows: Math.min(this.resolveMaxFetchedPosts(input), 8),
          select: 'DOI,title,abstract,published,URL,publisher,type',
          ...(mailto ? { mailto } : {}),
        },
        headers: {
          Accept: 'application/json',
          'User-Agent': mailto
            ? `NexoraAI-Graduation-Project (mailto:${mailto})`
            : 'NexoraAI-Graduation-Project',
        },
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_300 : 2_200,
      });

      return Array.isArray(response.data?.message?.items)
        ? [...response.data.message.items]
        : [];
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        CrossrefCollector.rateLimitCircuitOpenUntil = Math.max(
          CrossrefCollector.rateLimitCircuitOpenUntil,
          Date.now() + CrossrefCollector.RATE_LIMIT_COOLDOWN_MS,
        );
      }
      this.logger.debug(
        `Crossref query failed non-fatally. query="${query}" error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private mapWork(work: CrossrefWork, input: CollectorInput): CollectorPost {
    const title = this.titleOf(work);
    const abstract = this.cleanPlainText(work.abstract);
    const content = [title, abstract].filter(Boolean).join('. ').slice(0, 2_400);
    const doi = work.DOI?.trim();
    const url = work.URL?.trim() || (doi ? `https://doi.org/${doi}` : undefined);

    return {
      externalId: this.stableId(doi || url || title),
      title,
      content: content || title,
      author: this.cleanPlainText(work.publisher) || undefined,
      url,
      country: input.country,
      city: input.city,
      region: input.region,
      languageCode: this.resolveStoredLanguageCode(input.language),
      publishedAt: this.publishedAt(work),
      tags: [this.cleanPlainText(work.type), this.cleanPlainText(work.publisher)].filter(Boolean),
      comments: [],
    };
  }

  private titleOf(work: CrossrefWork): string {
    return this.cleanPlainText(Array.isArray(work.title) ? work.title[0] : '');
  }

  private publishedAt(work: CrossrefWork): Date | undefined {
    const dateParts = work.published?.['date-parts']?.[0];
    if (!dateParts?.length) return undefined;
    const [year, month = 1, day = 1] = dateParts;
    if (!year) return undefined;
    const value = new Date(Date.UTC(year, Math.max(0, month - 1), day));
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  private stableId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }
}
