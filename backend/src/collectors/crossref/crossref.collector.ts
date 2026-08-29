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
import { CanonicalRequestUnderstandingUtil } from '../../ideas/generation/utils/canonical-request-understanding.util';
import { SourceSpecificEvidenceQueryUtil } from '../../ideas/generation/utils/source-specific-evidence-query.util';

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

    const queryBudget = input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 4;
    const baseQueries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    });
    const problemProfile = input.requestDescription?.trim()
      ? CanonicalRequestUnderstandingUtil.resolve(input.requestDescription)
      : null;
    const queries = SourceSpecificEvidenceQueryUtil.compile({
      sourceKey: this.sourceKey,
      baseQueries,
      requestDescription: input.requestDescription,
      problemProfile,
      discoveryDomainName: input.domainName,
      maxQueries: queryBudget,
      preserveBaseQueries: false,
    });

    if (queries.length === 0) return [];

    /*
     * Crossref starts with the two highest-signal AI facets concurrently.
     * Four simultaneous calls were triggering 429s and paradoxically reducing
     * both recall and speed. If the first pair already fills the saved-evidence
     * budget, return immediately; otherwise launch the remaining pair in one
     * second bounded wave. This is adaptive concurrency, not reduced coverage.
     */
    const firstWave = await Promise.allSettled(
      queries.slice(0, 2).map((query) =>
        this.isRuntimeAvailable()
          ? this.search(query, input)
          : Promise.resolve<CrossrefWork[]>([]),
      ),
    );
    const firstWorks = firstWave.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    const distinctFirstWorks = new Set(
      firstWorks
        .map((work) => (work.DOI ?? work.URL ?? this.titleOf(work)).trim())
        .filter(Boolean),
    );

    let works = firstWorks;
    if (
      distinctFirstWorks.size < this.resolveMaxSavedPosts(input) &&
      queries.length > 2 &&
      this.isRuntimeAvailable()
    ) {
      const secondWave = await Promise.allSettled(
        queries.slice(2).map((query) =>
          this.isRuntimeAvailable()
            ? this.search(query, input)
            : Promise.resolve<CrossrefWork[]>([]),
        ),
      );
      works = [
        ...works,
        ...secondWave.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        ),
      ];
    }

    const seen = new Set<string>();
    return works
      .filter((work) => Boolean(this.titleOf(work)))
      .filter((work) => this.passesRequestIdentityGate(work, input))
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
          rows: Math.min(this.resolveMaxFetchedPosts(input), 12),
          select: 'DOI,title,abstract,published,URL,publisher,type',
          ...(mailto ? { mailto } : {}),
        },
        headers: {
          Accept: 'application/json',
          'User-Agent': mailto
            ? `NexoraAI-Graduation-Project (mailto:${mailto})`
            : 'NexoraAI-Graduation-Project',
        },
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 3_600 : 4_200,
        signal: CollectorAbortContextUtil.getSignal(),
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

  private passesRequestIdentityGate(
    work: CrossrefWork,
    input: CollectorInput,
  ): boolean {
    const request = this.cleanPlainText(input.requestDescription).toLocaleLowerCase();
    if (!request) return true;

    const evidence = this.cleanPlainText(
      `${this.titleOf(work)} ${work.abstract ?? ''}`,
    ).toLocaleLowerCase();
    if (!evidence) return false;

    /*
     * Crossref's bibliographic matcher is lexical. Reject well-known sense
     * collisions only when the requester context clearly points to the other
     * meaning. These are lexical disambiguation guards, not business verticals.
     */
    const computationalRuntime =
      /\b(?:runtime complexity|computational complexity|time complexity|algorithm(?:ic)? complexity|asymptotic complexity)\b/iu.test(evidence);
    const requesterIsComputational =
      /\b(?:algorithm|software|code|programming|computational|complexity|compiler|data structure)\b/iu.test(request);
    if (computationalRuntime && !requesterIsComputational) return false;

    const soapProtocol =
      /\b(?:soap web services?|soap api|soap protocol|wsdl|simple object access protocol)\b/iu.test(evidence);
    const requesterIsSoftwareSoap =
      /\b(?:soap web services?|soap api|soap protocol|wsdl|software|api|integration)\b/iu.test(request);
    if (soapProtocol && !requesterIsSoftwareSoap) return false;

    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: input.requestDescription,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries,
    });
    return (
      RequestVerticalConstraintUtil.matchesVertical(evidence, constraint) &&
      RequestVerticalConstraintUtil.matchesWorkflow(evidence, constraint)
    );
  }

  private mapWork(work: CrossrefWork, input: CollectorInput): CollectorPost {
    const title = this.titleOf(work);
    const abstract = this.cleanPlainText(work.abstract);
    const content = this.boundEvidenceText([title, abstract].filter(Boolean).join('. '), 3_600);
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

  private boundEvidenceText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    const window = normalized.slice(0, maxLength);
    const floor = Math.floor(maxLength * 0.68);
    const boundaries = [...window.matchAll(/[.!?](?:\s|$)/gu)]
      .map((match) => (match.index ?? 0) + 1)
      .filter((index) => index >= floor);
    const boundary = boundaries.at(-1);
    return (boundary ? window.slice(0, boundary) : window).trim();
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
