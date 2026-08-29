import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import {
  type CollectorRequestSupportInput,
  SocialCollector,
} from '../base/collector.interface';

import { CollectorInput, CollectorPost } from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';
import { CollectorAbortContextUtil } from '../base/collector-abort-context.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';
import { RequestEvidenceAlignmentUtil } from '../../ideas/generation/utils/request-evidence-alignment.util';
import { RequestDynamicQueryUtil } from '../../ideas/generation/utils/request-dynamic-query.util';

import { ForumAdapter } from './adapters/forum-adapter.interface';
import { DiscourseForumAdapter } from './adapters/discourse-forum.adapter';

type ForumSource = {
  url: string;
  adapter: ForumAdapter;
};

type StackExchangeOwner = {
  readonly display_name?: string;
};

type StackExchangeQuestion = {
  readonly question_id?: number;
  readonly title?: string;
  readonly body?: string;
  readonly link?: string;
  readonly owner?: StackExchangeOwner;
  readonly score?: number;
  readonly answer_count?: number;
  readonly creation_date?: number;
  readonly tags?: readonly string[];
};

type StackExchangeSearchResponse = {
  readonly items?: readonly StackExchangeQuestion[];
  readonly backoff?: number;
  readonly quota_remaining?: number;
};


type ForumSearchRssItem = {
  readonly title?: string;
  readonly link?: string;
  readonly content?: string;
  readonly contentSnippet?: string;
  readonly pubDate?: string;
  readonly isoDate?: string;
  readonly creator?: string;
  readonly author?: string;
};

/**
 * Generic forum collector.
 *
 * The collector currently supports Discourse forums.
 *
 * @author Malak
 */
@Injectable()
export class ForumCollector extends BaseCollector implements SocialCollector {
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'forum';

  private static stackExchangeCircuitOpenUntil = 0;

  private readonly rssParser = new Parser();

  private readonly forumSources: ForumSource[];

  constructor(
    configService: ConfigService,

    private readonly discourseForumAdapter: DiscourseForumAdapter,
  ) {
    super(configService, ForumCollector.name);

    this.forumSources = [
      {
        url: 'https://meta.discourse.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://forum.freecodecamp.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discourse.mozilla.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discourse.ubuntu.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discussion.fedoraproject.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discuss.kubernetes.io',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://community.grafana.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://forums.docker.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discuss.elastic.co',
        adapter: this.discourseForumAdapter,
      },
    ];
  }

  supportsRequest(input: CollectorRequestSupportInput): boolean {
    const bounded =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';
    if (!bounded) return true;

    if (this.isTechnicalRequest(input)) return true;
    if (this.resolveDirectForumDomains(input).length > 0) return true;
    if (this.shouldDiscoverSpecialistForums(input)) return true;
    if (ForumCollector.stackExchangeCircuitOpenUntil > Date.now()) return false;

    return this.resolveStackExchangeSites(input).length > 0;
  }

  private isTechnicalRequest(input: CollectorRequestSupportInput): boolean {
    const text = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));
    return /\b(?:api|sdk|source code|codebase|stack trace|exception|docker|kubernetes|container|database schema|webhook|endpoint|repository|github|programming|developer|software engineering|frontend|backend|javascript|typescript|python|java|linux|ubuntu|fedora|grafana|elastic)\b/u.test(text) ||
      /\b(?:software|application|app|server|container|node|javascript|typescript|python|java)\s+runtime\b|\bruntime\s+(?:error|exception|environment|version|dependency|crash)\b/u.test(text);
  }

  /**
   * Collects posts from configured forum sources.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Forum collection skipped because no search keywords exist.',
        );

        return [];
      }

      const isFastGeneration = input.collectionMode === 'FAST_GENERATION';
      const isTargetedRecovery = input.collectionMode === 'TARGETED_RECOVERY';
      const isBoundedGeneration = isFastGeneration || isTargetedRecovery;
      const boundedSourceLimit = isTargetedRecovery ? 2 : 1;
      const technicalRequest = this.isTechnicalRequest(input);
      const sources = isBoundedGeneration
        ? technicalRequest
          ? this.forumSources
              .filter((source) => source.url !== 'https://meta.discourse.org')
              .slice(0, boundedSourceLimit)
          : []
        : this.forumSources;
      const stackExchangeSites = isBoundedGeneration
        ? this.resolveStackExchangeSites(input)
        : [];
      const directForumDomains = isBoundedGeneration
        ? this.resolveDirectForumDomains(input).slice(0, isTargetedRecovery ? 2 : 3)
        : [];

      const specialistDiscoveryEnabled =
        isBoundedGeneration &&
        !technicalRequest &&
        this.shouldDiscoverSpecialistForums(input);
      this.logger.debug(
        `Forum source plan | collectionMode=${input.collectionMode ?? 'STANDARD'} | bounded=${isBoundedGeneration} | discourse=${sources.map((source) => source.url).join(',') || 'none'} | stackExchange=${stackExchangeSites.join(',') || 'none'} | webForums=${directForumDomains.join(',') || 'none'} | specialistDiscovery=${specialistDiscoveryEnabled}`,
      );

      const [results, stackExchangePosts, directForumPosts, specialistDiscoveryPosts] = await Promise.all([
        isBoundedGeneration
          ? Promise.allSettled(
              sources.map((source) =>
                source.adapter.collect(source.url, searchQuery, input),
              ),
            )
          : this.collectSequentially(sources, searchQuery, input),
        isBoundedGeneration
          ? this.collectFromStackExchange(input, stackExchangeSites)
          : Promise.resolve<CollectorPost[]>([]),
        isBoundedGeneration
          ? this.collectFromDirectForumDomains(input, directForumDomains)
          : Promise.resolve<CollectorPost[]>([]),
        specialistDiscoveryEnabled
          ? this.collectFromSpecialistForumDiscovery(input)
          : Promise.resolve<CollectorPost[]>([]),
      ]);

      const discoursePosts = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }

        this.logger.debug(
          `Forum source skipped | url=${sources[index]?.url ?? 'unknown'} | error=${this.getErrorMessage(result.reason)}`,
        );
        return [];
      });

      const rankedPosts = this.rankAndDeduplicatePosts(
        [...specialistDiscoveryPosts, ...directForumPosts, ...stackExchangePosts, ...discoursePosts],
        input,
      );

      this.logger.log(
        `Forum collection completed. Posts: ${rankedPosts.length}`,
      );

      return rankedPosts;
    } catch (error: unknown) {
      this.logger.warn('Forum collection failed', this.getErrorMessage(error));

      return [];
    }
  }

  private async collectFromStackExchange(
    input: CollectorInput,
    resolvedSites?: readonly string[],
  ): Promise<CollectorPost[]> {
    if (ForumCollector.stackExchangeCircuitOpenUntil > Date.now()) {
      return [];
    }

    const sites = resolvedSites ? [...resolvedSites] : this.resolveStackExchangeSites(input);
    if (sites.length === 0) return [];

    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    })
      .map((query) =>
        input.authoritativePlannedQueries
          ? query.trim()
          : query.split(/\s+/u).slice(0, 7).join(' '),
      )
      .filter(Boolean)
      .slice(0, input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3);

    if (queries.length === 0) return [];

    /*
     * Preserve every authoritative source-plan query. The previous multi-site
     * branch executed only queries[0], so a PRIMARY plan carrying three AI
     * queries could silently lose queries[1]/queries[2] before any HTTP call.
     * Distribute the bounded query set across resolved sites instead of taking
     * the Cartesian product; this keeps all planner intent while retaining the
     * same small request budget.
     */
    const requests = queries.map((query, index) =>
      this.searchStackExchange(sites[index % sites.length], query, input),
    );
    const settled = await Promise.allSettled(requests);
    const firstPass = settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    if (
      firstPass.length >= 2 ||
      !input.requestDescription?.trim() ||
      ForumCollector.stackExchangeCircuitOpenUntil > Date.now()
    ) {
      return firstPass;
    }

    const attempted = new Set(queries.map((query) => query.toLocaleLowerCase()));
    const fallbackQueries = ProblemFirstCollectorQueryUtil.buildProgressiveFallback({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    })
      .map((query) => query.split(/\s+/u).slice(0, 5).join(' '))
      .filter(Boolean)
      .filter((query) => !attempted.has(query.toLocaleLowerCase()))
      .slice(0, 2);

    if (fallbackQueries.length === 0) return firstPass;
    const fallbackRequests = sites.flatMap((site) =>
      fallbackQueries.slice(0, 1).map((query) =>
        this.searchStackExchange(site, query, input),
      ),
    );
    const fallbackSettled = await Promise.allSettled(fallbackRequests);
    return [
      ...firstPass,
      ...fallbackSettled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
    ];
  }

  /**
   * Converts executable forum routing hints into concrete public domains.
   * Label-only hints are supported for a small set of well-known specialist
   * communities; URL/domain hints work generically without a code change.
   */
  private resolveDirectForumDomains(input: CollectorRequestSupportInput): string[] {
    const domains: string[] = [];
    const add = (value: string) => {
      const normalized = value
        .trim()
        .toLocaleLowerCase()
        .replace(/^https?:\/\//u, '')
        .replace(/^www\./u, '')
        .split('/')[0]
        ?.replace(/[^a-z0-9.-]/gu, '');
      if (!normalized || !normalized.includes('.')) return;
      if (!domains.includes(normalized)) domains.push(normalized);
    };

    for (const hint of input.sourceHints ?? []) {
      const urlMatch = hint.match(/https?:\/\/([^/\s]+)/iu);
      const domainMatch = hint.match(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/iu);
      if (urlMatch?.[1]) add(urlMatch[1]);
      else if (domainMatch?.[1]) add(domainMatch[1]);
    }

    return domains.slice(0, 4);
  }

  private shouldDiscoverSpecialistForums(
    input: CollectorRequestSupportInput,
  ): boolean {
    const request = this.cleanNormalizedText(input.requestDescription ?? '');
    if (!request || this.isTechnicalRequest(input)) return false;

    return (
      (input.plannedQueries ?? []).some((query) => query.trim().length > 0) ||
      (input.sourceHints ?? []).some((hint) => hint.trim().length > 0)
    );
  }

  private buildSpecialistForumDiscoveryQueries(
    input: CollectorInput,
  ): string[] {
    const queries: string[] = [];
    const add = (value: string) => {
      const cleaned = value.replace(/\s+/gu, ' ').trim();
      if (!cleaned) return;
      const key = cleaned.toLocaleLowerCase();
      if (!queries.some((item) => item.toLocaleLowerCase() === key)) {
        queries.push(cleaned);
      }
    };

    for (const hint of input.sourceHints ?? []) {
      if (/https?:\/\//iu.test(hint) || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/iu.test(hint)) {
        continue;
      }
      add(`${hint.split(/\s+/u).slice(0, 8).join(' ')} forum discussion`);
    }

    for (const query of input.plannedQueries ?? []) {
      const compact = query.split(/\s+/u).filter(Boolean).slice(0, 9).join(' ');
      add(`${compact} forum discussion`);
      add(`${compact} practitioner community`);
      if (queries.length >= 5) break;
    }

    if (queries.length < 5 && input.requestDescription?.trim()) {
      const generic = RequestDynamicQueryUtil.buildProfessionalEvidenceQueries({
        requestDescription: input.requestDescription,
        plannedQueries: input.plannedQueries,
        evidenceTargets: [],
        maxQueries: 5,
      });
      for (const query of generic) {
        add(`${query} forum discussion`);
        if (queries.length >= 5) break;
      }
    }

    return queries.slice(0, 5);
  }

  private async collectFromSpecialistForumDiscovery(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const queries = this.buildSpecialistForumDiscoveryQueries(input);
    if (queries.length === 0) return [];

    const blockedHosts = new Set([
      'reddit.com', 'facebook.com', 'instagram.com', 'linkedin.com',
      'youtube.com', 'pinterest.com', 'quora.com', 'stackoverflow.com',
      'stackexchange.com', 'medium.com',
    ]);
    const settled = await Promise.allSettled(
      queries.map(async (query, queryIndex) => {
        const response = await axios.get<string>('https://www.bing.com/search', {
          params: { q: query, format: 'rss', count: 10 },
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'Voxidence-Evidence-Collector/1.0',
          },
          responseType: 'text',
          timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_600 : 3_000,
          signal: CollectorAbortContextUtil.getSignal(),
        });
        const feed = await this.rssParser.parseString(response.data);
        return (feed.items ?? [])
          .map((raw, itemIndex): CollectorPost | null => {
            const item = raw as ForumSearchRssItem;
            const link = item.link?.trim() ?? '';
            if (!link) return null;
            let url: URL;
            try {
              url = new URL(link);
            } catch {
              return null;
            }
            const host = url.hostname.replace(/^www\./u, '').toLocaleLowerCase();
            if ([...blockedHosts].some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
              return null;
            }
            const title = this.cleanPlainText(item.title);
            const content = this.cleanPlainText(item.contentSnippet ?? item.content) || title;
            const candidateText = `${title} ${content}`;
            if (!this.passesSpecialistDiscoveryIdentityGate(input, candidateText, host)) {
              return null;
            }
            const discussionSignal = this.cleanNormalizedText(
              `${host} ${url.pathname} ${title} ${content.slice(0, 240)}`,
            );
            if (!/\b(?:forum|forums|community|discussion|discussions|thread|threads|topic|topics|message board|bulletin board|members?)\b/u.test(discussionSignal)) {
              return null;
            }
            if (!title || content.length < 24) return null;
            const externalKey = Buffer.from(link).toString('base64url').slice(0, 120);
            return {
              externalId: `specialist-discovery:${queryIndex}:${itemIndex}:${externalKey}`,
              title,
              content,
              author: this.cleanPlainText(item.creator ?? item.author) || host,
              url: link,
              country: input.country, city: input.city, region: input.region,
              languageCode: this.resolveStoredLanguageCode(input.language),
              likesCount: 0, repliesCount: 0,
              publishedAt: this.parseDate(item.isoDate ?? item.pubDate),
              tags: [host, 'specialist-forum-discovery'],
              comments: [],
            };
          })
          .filter((post): post is CollectorPost => Boolean(post));
      }),
    );

    return settled
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .slice(0, this.maxFetchedPosts);
  }

  private async collectFromDirectForumDomains(
    input: CollectorInput,
    domains: readonly string[],
  ): Promise<CollectorPost[]> {
    if (domains.length === 0) return [];

    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    })
      .map((query) =>
        input.authoritativePlannedQueries
          ? query.trim()
          : query.split(/\s+/u).slice(0, 8).join(' '),
      )
      .filter(Boolean)
      .slice(0, 2);
    if (queries.length === 0) return [];

    const requests = domains.flatMap((domain, domainIndex) =>
      queries
        .slice(0, domains.length > 1 ? 1 : 2)
        .map((query) => this.searchDirectForumDomain(domain, query, input, domainIndex)),
    );
    const settled = await Promise.allSettled(requests);
    return settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
  }

  private async searchDirectForumDomain(
    domain: string,
    query: string,
    input: CollectorInput,
    domainIndex: number,
  ): Promise<CollectorPost[]> {
    const search = `site:${domain} ${query}`;
    try {
      const response = await axios.get<string>('https://www.bing.com/search', {
        params: { q: search, format: 'rss', count: Math.min(this.maxFetchedPosts, 8) },
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'Voxidence-Evidence-Collector/1.0',
        },
        responseType: 'text',
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_200 : 2_600,
        signal: CollectorAbortContextUtil.getSignal(),
      });
      const feed = await this.rssParser.parseString(response.data);
      return (feed.items ?? [])
        .map((raw, index): CollectorPost | null => {
          const item = raw as ForumSearchRssItem;
          const link = item.link?.trim() ?? '';
          if (!link) return null;
          let host = '';
          try {
            host = new URL(link).hostname.replace(/^www\./u, '').toLocaleLowerCase();
          } catch {
            return null;
          }
          if (host !== domain && !host.endsWith(`.${domain}`)) return null;
          const title = this.cleanPlainText(item.title);
          const content = this.cleanPlainText(item.contentSnippet ?? item.content) || title;
          if (!title || content.length < 20) return null;
          if (!this.passesSpecialistDiscoveryIdentityGate(input, `${title} ${content}`, host)) {
            return null;
          }
          const externalKey = Buffer.from(link).toString('base64url').slice(0, 120);
          return {
            externalId: `webforum:${domainIndex}:${index}:${externalKey}`,
            title,
            content,
            author: this.cleanPlainText(item.creator ?? item.author) || domain,
            url: link,
            country: input.country,
            city: input.city,
            region: input.region,
            languageCode: this.resolveStoredLanguageCode(input.language),
            likesCount: 0,
            repliesCount: 0,
            publishedAt: this.parseDate(item.isoDate ?? item.pubDate),
            tags: [domain, 'specialist-forum'],
            comments: [],
          };
        })
        .filter((post): post is CollectorPost => Boolean(post))
        .slice(0, this.maxFetchedPosts);
    } catch (error: unknown) {
      this.logger.debug(
        `Direct forum web search skipped | domain=${domain} | query=${query} | error=${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private passesSpecialistDiscoveryIdentityGate(
    input: CollectorRequestSupportInput,
    candidateText: string,
    host: string,
  ): boolean {
    const request = input.requestDescription ?? '';
    const evidence = this.cleanNormalizedText(candidateText);
    if (!evidence) return false;

    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: request,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (constraint.strict) {
      const classification = RequestEvidenceAlignmentUtil.classifyForRequestFallback({
        requestDescription: request,
        evidenceText: evidence,
        plannedQueries: input.plannedQueries ?? [],
      });
      if (classification !== 'UNRELATED') return true;
      return (
        RequestVerticalConstraintUtil.matchesVertical(evidence, constraint) &&
        RequestVerticalConstraintUtil.matchesWorkflow(evidence, constraint)
      );
    }

    return true;
  }

  private resolveStackExchangeSites(input: CollectorRequestSupportInput): string[] {
    const sites: string[] = [];
    const add = (site: string) => {
      const normalized = site
        .trim()
        .toLocaleLowerCase()
        .replace(/^https?:\/\//u, '')
        .replace(/^www\./u, '')
        .split('/')[0] ?? '';
      if (!normalized) return;
      if (/^(?:[a-z0-9-]+\.)?stackexchange\.com$/u.test(normalized)) {
        if (!sites.includes(normalized)) sites.push(normalized);
        return;
      }
      if (['stackoverflow.com', 'serverfault.com', 'superuser.com', 'askubuntu.com'].includes(normalized)) {
        if (!sites.includes(normalized)) sites.push(normalized);
      }
    };

    for (const hint of input.sourceHints ?? []) {
      const urlMatch = hint.match(/https?:\/\/([^/\s]+)/iu);
      const domainMatch = hint.match(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/iu);
      if (urlMatch?.[1]) add(urlMatch[1]);
      else if (domainMatch?.[1]) add(domainMatch[1]);
    }

    return sites.slice(0, 2);
  }

  private normalizeStackExchangeApiSite(site: string): string {
    const normalized = site
      .trim()
      .toLocaleLowerCase()
      .replace(/^https?:\/\//u, '')
      .replace(/^www\./u, '')
      .replace(/\/$/u, '');

    const stackExchange = normalized.match(/^([a-z0-9-]+)\.stackexchange\.com$/u);
    if (stackExchange?.[1]) return stackExchange[1];
    if (normalized === 'stackoverflow.com') return 'stackoverflow';
    if (normalized === 'serverfault.com') return 'serverfault';
    if (normalized === 'superuser.com') return 'superuser';
    if (normalized === 'askubuntu.com') return 'askubuntu';
    if (normalized === 'mathoverflow.net') return 'mathoverflow';
    return normalized;
  }

  private async searchStackExchange(
    site: string,
    query: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    if (ForumCollector.stackExchangeCircuitOpenUntil > Date.now()) {
      return [];
    }

    try {
      const apiSite = this.normalizeStackExchangeApiSite(site);
      const response = await axios.get<StackExchangeSearchResponse>(
        'https://api.stackexchange.com/2.3/search/advanced',
        {
          params: {
            site: apiSite,
            q: query,
            sort: 'relevance',
            order: 'desc',
            pagesize: Math.min(this.maxFetchedPosts, 10),
            filter: 'withbody',
          },
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Voxidence-Evidence-Collector/1.0',
          },
          timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_600 : 3_300,
          signal: CollectorAbortContextUtil.getSignal(),
        },
      );

      const backoffSeconds = Number(response.data?.backoff ?? 0);
      if (Number.isFinite(backoffSeconds) && backoffSeconds > 0) {
        ForumCollector.stackExchangeCircuitOpenUntil = Math.max(
          ForumCollector.stackExchangeCircuitOpenUntil,
          Date.now() + backoffSeconds * 1_000,
        );
      }
      const questions = Array.isArray(response.data?.items)
        ? [...response.data.items]
        : [];
      return questions
        .filter((question) => Boolean(question.question_id && question.title))
        .slice(0, this.maxFetchedPosts)
        .map((question): CollectorPost => {
          const title = this.cleanPlainText(question.title);
          const body = this.cleanPlainText(question.body);
          return {
            externalId: `stackexchange:${site}:${question.question_id}`,
            title,
            content: body || title,
            author: this.cleanPlainText(question.owner?.display_name) || site,
            url: question.link,
            country: input.country,
            city: input.city,
            region: input.region,
            languageCode: this.resolveStoredLanguageCode(input.language),
            likesCount: Math.max(0, question.score ?? 0),
            repliesCount: Math.max(0, question.answer_count ?? 0),
            publishedAt: question.creation_date
              ? new Date(question.creation_date * 1000)
              : undefined,
            tags: [...(question.tags ?? []), site],
            comments: [],
          };
        });
    } catch (error: unknown) {
      const errorMessage = this.getErrorMessage(error);
      if (/\b429\b|rate limit|too many requests/iu.test(errorMessage)) {
        ForumCollector.stackExchangeCircuitOpenUntil = Math.max(
          ForumCollector.stackExchangeCircuitOpenUntil,
          Date.now() + 60_000,
        );
      }
      this.logger.debug(
        `Stack Exchange forum query skipped | site=${site} | query=${query} | error=${errorMessage}`,
      );
      return [];
    }
  }

  private async collectSequentially(
    sources: readonly ForumSource[],
    searchQuery: string,
    input: CollectorInput,
  ): Promise<PromiseSettledResult<CollectorPost[]>[]> {
    const results: PromiseSettledResult<CollectorPost[]>[] = [];

    for (const source of sources) {
      try {
        const posts = await source.adapter.collect(
          source.url,
          searchQuery,
          input,
        );
        results.push({ status: 'fulfilled', value: posts });
      } catch (reason: unknown) {
        results.push({ status: 'rejected', reason });
      }
    }

    return results;
  }

  /**
   * Removes duplicate forum posts and ranks them.
   */
  private rankAndDeduplicatePosts(
    posts: CollectorPost[],
    input: CollectorInput,
  ): CollectorPost[] {
    const seenPostIds = new Set<string>();

    return posts
      .filter((post) => {
        const key = `${post.url ?? ''}-${post.externalId}`;

        if (seenPostIds.has(key)) {
          return false;
        }

        seenPostIds.add(key);

        return true;
      })
      .map((post) => ({
        post,
        score: this.calculatePostRelevanceScore(post, input),
      }))
      .filter((item) => item.score >= 3)
      .sort((first, second) => second.score - first.score)
      .slice(0, this.maxSavedPosts)
      .map((item) => item.post);
  }

  /**
   * Builds the forum search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const plannedQuery = (input.plannedQueries ?? [])
      .map((query) => this.cleanNormalizedText(query))
      .find(Boolean);
    if (plannedQuery) {
      return plannedQuery.split(/\s+/u).slice(0, 10).join(' ');
    }

    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    return this.unique([...userKeywords, ...domainKeywords, ...fallbackDomain])
      .slice(0, 4)
      .join(' ');
  }

  /**
   * Calculates forum-post relevance.
   */
  private calculatePostRelevanceScore(
    post: CollectorPost,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post.title,
      body: post.content,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.likesCount ?? 0,
      replies: post.repliesCount ?? 0,
      publishedAt: post.publishedAt,
    });
  }

  /** Parses an optional external publication date without throwing. */
  private parseDate(value?: string): Date | undefined {
    if (!value?.trim()) return undefined;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  /**
   * Reads forum-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('FORUM_BLOCKED_WORDS');
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown Forum collector error.';
  }
}