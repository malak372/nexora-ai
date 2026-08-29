import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
import {
  type CollectorRequestSupportInput,
  SocialCollector,
} from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';
import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { CollectorAbortContextUtil } from '../base/collector-abort-context.util';

/**
 * Represents an RSS feed item.
 */
type RssItem = {
  guid?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  creator?: string;
  author?: string;
  isoDate?: string;
  pubDate?: string;
};

/**
 * Blog collector.
 *
 * Collects public blog articles from RSS feeds.
 *
 * @author Malak
 */
@Injectable()
export class BlogCollector extends BaseCollector implements SocialCollector {
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'blog';

  /**
   * RSS parser instance.
   */
  private readonly parser = new Parser();

  /**
   * Broken/stale RSS endpoints must not consume the bounded generation budget
   * on every run. Query-web search still runs in parallel, so temporarily
   * cooling a failing feed never removes the Blog evidence lane entirely.
   */
  private static readonly feedFailureCooldownUntil = new Map<string, number>();
  private static readonly NOT_FOUND_FEED_COOLDOWN_MS = 30 * 60 * 1000;
  private static readonly TRANSIENT_FEED_COOLDOWN_MS = 2 * 60 * 1000;

  constructor(configService: ConfigService) {
    super(configService, BlogCollector.name);
  }

  supportsRequest(input: CollectorRequestSupportInput): boolean {
    const bounded =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';
    if (!bounded) return true;

    return (
      this.hasDedicatedFeedsForDomain(input.domainName ?? undefined) ||
      Boolean(input.requestDescription?.trim()) ||
      (input.plannedQueries ?? []).some((query) => query.trim().length > 0)
    );
  }

  /**
   * Collects and ranks RSS blog articles.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Blog collection skipped because no search keywords exist.',
        );

        return [];
      }

      const hasDedicatedFeeds = this.hasDedicatedFeedsForDomain(input.domainName);
      const [rssPosts, queryWebPosts] = await Promise.all([
        hasDedicatedFeeds
          ? this.collectFromRssFeeds(input)
          : Promise.resolve<CollectorPost[]>([]),
        this.collectFromQueryWebSearch(input),
      ]);
      const seenPostIds = new Set<string>();

      const rankedPosts = [...queryWebPosts, ...rssPosts]
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
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts)
        .map((item) => item.post);

      this.logger.log(
        `Blog collection completed. Posts: ${rankedPosts.length}`,
      );

      return rankedPosts;
    } catch (error: unknown) {
      this.logger.warn('Blog collection failed', this.getErrorMessage(error));

      return [];
    }
  }

  /**
   * Query-driven broad-web evidence lane used during bounded idea generation.
   *
   * The legacy blog collector depended only on a small hard-coded RSS feed
   * dictionary, so a well-planned niche request could still return zero rows.
   * This lane searches the public web with the AI-owned/request-grounded
   * queries and returns ordinary article snippets. Canonical evidence
   * verification remains authoritative; search snippets are never trusted just
   * because they were returned by the search engine.
   */
  private async collectFromQueryWebSearch(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    if (
      input.collectionMode !== 'FAST_GENERATION' &&
      input.collectionMode !== 'TARGETED_RECOVERY'
    ) {
      return [];
    }

    const queries = [
      ...(input.plannedQueries ?? []),
      this.buildSearchQuery(input),
    ]
      .map((query) => query.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .filter((query, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
        ) === index,
      )
      .slice(0, input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3);
    if (queries.length === 0) return [];

    const blockedHosts = new Set([
      'facebook.com',
      'instagram.com',
      'linkedin.com',
      'pinterest.com',
      'youtube.com',
      'tiktok.com',
    ]);
    const settled = await Promise.allSettled(
      queries.map(async (query, queryIndex) => {
        const response = await axios.get<string>('https://www.bing.com/search', {
          params: {
            q: query,
            format: 'rss',
            count: Math.min(10, this.maxFetchedPosts),
          },
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'Voxidence-Evidence-Collector/1.0',
          },
          responseType: 'text',
          timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_400 : 2_800,
          signal: CollectorAbortContextUtil.getSignal(),
        });
        const feed = await this.parser.parseString(response.data);
        return (feed.items ?? [])
          .map((raw: unknown, itemIndex: number): CollectorPost | null => {
            const item = raw as RssItem;
            const link = item.link?.trim() ?? '';
            if (!link) return null;
            let host = '';
            try {
              host = new URL(link).hostname
                .replace(/^www\./u, '')
                .toLocaleLowerCase();
            } catch {
              return null;
            }
            if (
              [...blockedHosts].some(
                (blocked) => host === blocked || host.endsWith(`.${blocked}`),
              )
            ) {
              return null;
            }
            const title = this.cleanPlainText(item.title);
            const content = this.cleanPlainText(
              item.contentSnippet ?? item.content ?? item.summary ?? title,
            );
            if (!title || content.length < 24) return null;
            if (!this.isPlausibleQueryWebResult(query, title, content, input)) {
              return null;
            }
            const externalKey = Buffer.from(link)
              .toString('base64url')
              .slice(0, 120);
            return {
              externalId: `web-search:${queryIndex}:${itemIndex}:${externalKey}`,
              title,
              content,
              author:
                this.cleanPlainText(item.creator ?? item.author) || host,
              url: link,
              country: input.country,
              city: input.city,
              region: input.region,
              languageCode: this.resolveStoredLanguageCode(input.language),
              likesCount: 0,
              repliesCount: 0,
              publishedAt: this.parseDate(item.isoDate ?? item.pubDate),
              tags: [host, 'query-web-evidence'],
              comments: [],
            };
          })
          .filter((post: CollectorPost | null): post is CollectorPost => Boolean(post));
      }),
    );

    return settled
      .flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      )
      .slice(0, this.maxFetchedPosts);
  }


  /**
   * Cheap lexical admission gate for broad Bing RSS search results.
   *
   * This runs before a result consumes the bounded raw-corpus budget. It is
   * intentionally conservative: the canonical Community AI verifier still
   * decides whether a retained item is evidence, while this gate only rejects
   * obvious search-engine drift (for example SOAP protocol pages for a
   * handmade-soap workflow or an unrelated transport authority homepage).
   */
  private isPlausibleQueryWebResult(
    query: string,
    title: string,
    content: string,
    input: CollectorInput,
  ): boolean {
    const evidenceTokens = new Set(
      this.extractSignificantSearchTokens(`${title} ${content}`),
    );
    const queryTokens = this.extractSignificantSearchTokens(query);
    if (queryTokens.length === 0) return true;

    const queryOverlap = queryTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const requiredQueryOverlap = queryTokens.length <= 2 ? 1 : 2;
    if (queryOverlap < requiredQueryOverlap) return false;

    const requestCorpus = [
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.domainKeywords ?? []),
      ...(input.keywords ?? []),
    ]
      .join(' ')
      .trim();
    if (!requestCorpus) return true;

    const requestTokens = this.extractSignificantSearchTokens(requestCorpus);
    if (requestTokens.length === 0) return true;
    const requestOverlap = requestTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;

    // Planned queries are already request-grounded, so one additional request
    // identity token is enough after the query itself matched. For broad
    // fallback queries require two where possible.
    const authoritative = Boolean(input.authoritativePlannedQueries);
    const requiredRequestOverlap =
      authoritative || requestTokens.length <= 3 ? 1 : 2;

    return requestOverlap >= requiredRequestOverlap;
  }

  /** Returns stable content words for the broad-web admission check. */
  private extractSignificantSearchTokens(value: string): string[] {
    const stopWords = new Set<string>([
      'about', 'after', 'again', 'also', 'among', 'around', 'because', 'before',
      'being', 'between', 'could', 'during', 'from', 'have', 'into', 'more',
      'most', 'other', 'over', 'same', 'such', 'than', 'that', 'their', 'there',
      'these', 'they', 'this', 'through', 'under', 'using', 'very', 'what',
      'when', 'where', 'which', 'while', 'with', 'would', 'your', 'problem',
      'problems', 'issue', 'issues', 'challenge', 'challenges', 'report',
      'reports', 'complaint', 'complaints', 'difficulty', 'difficult',
      'system', 'systems', 'business', 'businesses', 'workflow', 'workflows',
      'the', 'and', 'for', 'are', 'was', 'were', 'has', 'had', 'not', 'can',
      'في', 'من', 'على', 'إلى', 'الى', 'عن', 'مع', 'هذا', 'هذه', 'التي',
      'الذي', 'كان', 'كانت', 'يتم', 'عدم', 'مشكلة', 'مشاكل', 'تحديات',
    ]);

    return [...new Set<string>(
      this.cleanNormalizedText(value)
        .replace(/[^\p{L}\p{N}+#._-]+/gu, ' ')
        .split(/\s+/u)
        .map((token) => token.replace(/^[._-]+|[._-]+$/gu, '').trim())
        .filter((token) => token.length >= 3 && !stopWords.has(token)),
    )].slice(0, 48);
  }

  /**
   * Collects articles from configured RSS feeds.
   */
  private async collectFromRssFeeds(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const feeds = this.getFeedsForDomain(input.domainName);
    const feedResults = await Promise.allSettled(
      feeds.map((feedUrl) => this.collectFromFeed(feedUrl, input)),
    );

    for (const [index, result] of feedResults.entries()) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Blog feed skipped after parallel fetch failure: ${feeds[index]} - ${this.getErrorMessage(result.reason)}`,
        );
      }
    }

    return feedResults.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
  }

  /**
   * Collects articles from one RSS feed.
   */
  private async collectFromFeed(
    feedUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const cooldownUntil = BlogCollector.feedFailureCooldownUntil.get(feedUrl) ?? 0;
    if (cooldownUntil > Date.now()) {
      this.logger.debug(
        `Blog feed skipped because its temporary failure cooldown is active: ${feedUrl}`,
      );
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'rss-feed', [
        feedUrl,
      ]);

      const feed = await CollectorExternalCacheUtil.remember(
        cacheKey,
        this.cacheTtlMs,
        () => this.parser.parseURL(feedUrl),
      );
      BlogCollector.feedFailureCooldownUntil.delete(feedUrl);

      return (feed.items ?? [])
        .filter((item) => this.isValidRssArticle(item as RssItem))
        .slice(0, this.maxFetchedPosts)
        .map((item): CollectorPost => {
          const rssItem = item as RssItem;

          const title = this.cleanPlainText(rssItem.title);

          return {
            externalId: rssItem.guid ?? rssItem.link ?? title,

            title,

            content: this.cleanPlainText(
              rssItem.contentSnippet ??
                rssItem.content ??
                rssItem.summary ??
                title,
            ),

            author: this.cleanPlainText(
              rssItem.creator ?? rssItem.author ?? feed.title,
            ),

            url: rssItem.link,

            country: input.country,
            city: input.city,
            region: input.region,

            languageCode: this.resolveStoredLanguageCode(input.language),

            likesCount: 0,
            repliesCount: 0,

            publishedAt: this.parseDate(rssItem.isoDate ?? rssItem.pubDate),

            comments: [],
          };
        });
    } catch (error: unknown) {
      const errorMessage = this.getErrorMessage(error);
      const cooldownMs = /(?:status(?: code)?\s*)?404\b/iu.test(errorMessage)
        ? BlogCollector.NOT_FOUND_FEED_COOLDOWN_MS
        : BlogCollector.TRANSIENT_FEED_COOLDOWN_MS;
      BlogCollector.feedFailureCooldownUntil.set(
        feedUrl,
        Date.now() + cooldownMs,
      );
      this.logger.warn(
        `Blog feed skipped: ${feedUrl} - ${errorMessage}`,
      );

      return [];
    }
  }

  /**
   * Builds the primary blog query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const plannedQuery = (input.plannedQueries ?? [])
      .map((query) => this.cleanNormalizedText(query))
      .find(Boolean);
    if (plannedQuery) {
      return plannedQuery.split(/\s+/u).slice(0, 10).join(' ');
    }

    const userKeyword = input.keywords?.[0]
      ? this.cleanNormalizedText(input.keywords[0])
      : '';

    if (userKeyword) {
      return userKeyword;
    }

    const domainName = this.cleanNormalizedText(input.domainName);

    if (domainName) {
      return domainName;
    }

    return this.getDomainKeywords(input)[0] ?? '';
  }

  /**
   * Validates an RSS article.
   */
  private isValidRssArticle(item: RssItem): boolean {
    const title = this.cleanPlainText(item.title);

    const content = this.cleanPlainText(
      item.contentSnippet ?? item.content ?? item.summary,
    );

    if (!title || !item.link || content.length < 80) {
      return false;
    }

    const normalizedContent = this.cleanNormalizedText(`${title} ${content}`);

    const cleaned = normalizedContent.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      normalizedContent.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates blog-post relevance.
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

  private hasDedicatedFeedsForDomain(domainName?: string): boolean {
    const domain = this.cleanNormalizedText(domainName);
    return new Set([
      'education',
      'healthcare',
      'health',
      'finance',
      'cybersecurity',
      'security',
      'artificial intelligence',
      'ai',
      'technology',
      'tech',
    ]).has(domain);
  }

  /**
   * Returns RSS feeds for the selected domain.
   */
  private getFeedsForDomain(domainName?: string): string[] {
    const domain = this.cleanNormalizedText(domainName);

    const dictionary: Record<string, string[]> = {
      education: [
        'https://www.edutopia.org/rss.xml',
        'https://www.edsurge.com/articles_rss',
      ],

      healthcare: [
        'https://www.health.harvard.edu/blog/feed',
        'https://www.medicalnewstoday.com/rss',
      ],

      health: [
        'https://www.health.harvard.edu/blog/feed',
        'https://www.medicalnewstoday.com/rss',
      ],

      finance: [
        'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline',
      ],

      cybersecurity: [
        'https://krebsonsecurity.com/feed/',
        'https://www.schneier.com/feed/atom/',
      ],

      security: [
        'https://krebsonsecurity.com/feed/',
        'https://www.schneier.com/feed/atom/',
      ],

      'artificial intelligence': [
        'https://machinelearningmastery.com/feed/',
        'https://openai.com/news/rss.xml',
      ],

      ai: [
        'https://machinelearningmastery.com/feed/',
        'https://openai.com/news/rss.xml',
      ],

      technology: [
        'https://techcrunch.com/feed/',
        'https://www.theverge.com/rss/index.xml',
      ],

      tech: [
        'https://techcrunch.com/feed/',
        'https://www.theverge.com/rss/index.xml',
      ],

      other: [
        'https://techcrunch.com/feed/',
        'https://www.theverge.com/rss/index.xml',
      ],
    };

    return dictionary[domain] ?? dictionary.other;
  }

  /**
   * Reads Blog-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('BLOG_BLOCKED_WORDS');
  }

  /**
   * Parses an external date safely.
   */
  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown Blog collector error.';
  }
}
