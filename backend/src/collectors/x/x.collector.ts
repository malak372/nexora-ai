import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';

import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorQueryBuilderUtil } from '../base/collector-query-builder.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * X collector.
 *
 * Collects public X posts using X API v2 Search.
 *
 * @author Malak
 */
@Injectable()
export class XCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.X;

  private readonly platformName = 'X';
  private readonly apiBaseUrl = 'https://api.x.com/2';

  private readonly maxSearchQueries: number;
  private readonly searchMode: 'recent' | 'all';

  constructor(configService: ConfigService) {
    super(configService, XCollector.name);

    this.maxSearchQueries =
      Number(this.configService.get('COLLECTOR_MAX_SEARCH_QUERIES')) || 4;

    this.searchMode =
      this.configService.get<string>('X_SEARCH_MODE') === 'all'
        ? 'all'
        : 'recent';
  }

  /**
   * Collects public X posts based on the selected domain and user keywords.
   *
   * @param input Collection request context.
   * @returns A list of normalized collector posts.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const queries = this.buildSearchQueries(input).slice(
      0,
      this.maxSearchQueries,
    );

    if (!queries.length) {
      this.logger.warn('X collection skipped because no domain keywords exist.');
      return [];
    }

    const collectedPosts: CollectorPost[] = [];
    const seenPostIds = new Set<string>();

    try {
      for (const query of queries) {
        if (collectedPosts.length >= this.maxSavedPosts) break;

        const response = await this.searchPosts(input, query);
        const posts = response?.data ?? [];
        const users = this.mapIncludedUsers(response?.includes?.users ?? []);

        const rankedPosts = posts
          .filter((post: any) => this.isValidPost(post))
          .filter((post: any) => this.matchesInputContext(post, input))
          .map((post: any) => ({
            post,
            score: this.calculatePostRelevanceScore(post, input),
          }))
          .filter((item: any) => item.score > 0)
          .sort((a: any, b: any) => b.score - a.score);

        for (const item of rankedPosts) {
          if (collectedPosts.length >= this.maxSavedPosts) break;

          const post = item.post;

          if (!post?.id || seenPostIds.has(post.id)) continue;

          seenPostIds.add(post.id);
          collectedPosts.push(this.mapXPostToCollectorPost(post, users, input));
        }
      }

      this.logger.log(`X collection completed. Posts: ${collectedPosts.length}`);
      return collectedPosts;
    } catch (error: any) {
      this.logger.error(
        'X collection failed',
        error.response?.data ?? error.message,
      );

      throw new ServiceUnavailableException(
        'X collection failed. Check X credentials, search mode access, API credits, rate limits, or network connection.',
      );
    }
  }

  /**
   * Searches X posts using the configured search mode.
   *
   * @param input Collection request context.
   * @param query X API search query.
   * @returns Raw X API response.
   */
  private async searchPosts(
    input: CollectorInput,
    query: string,
  ): Promise<any> {
    const endpoint =
      this.searchMode === 'all'
        ? `${this.apiBaseUrl}/tweets/search/all`
        : `${this.apiBaseUrl}/tweets/search/recent`;

    const cacheKey = CollectorCacheUtil.build('x', 'search', [
      this.searchMode,
      query,
      input.country,
      input.language,
    ]);

    return CollectorHttpUtil.getWithRetryAndCache<any>(
      endpoint,
      {
        headers: this.buildHeaders(),
        params: {
          query,
          max_results: Math.min(Math.max(this.maxFetchedPosts, 10), 100),
          'tweet.fields':
            'id,text,created_at,author_id,lang,public_metrics,conversation_id',
          'user.fields': 'id,name,username,location',
          expansions: 'author_id',
        },
        timeout: 10000,
      },
      {
        cacheKey,
        cacheTtlMs: this.cacheTtlMs,
        retryAttempts: this.retryAttempts,
        retryDelayMs: this.retryDelayMs,
      },
    );
  }

  /**
   * Builds X search queries from domain keywords, user keywords,
   * and problem-related terms.
   *
   * @param input Collection request context.
   * @returns A list of X search queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    if (!domainKeywords.length) return [];

    const problemWords = this.getProblemWords();

    const domainQueries = CollectorQueryBuilderUtil.buildProblemQueries(
      domainKeywords,
      problemWords,
    ).map((query) => this.buildXQuery(query, input));

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.normalizeQuery(keyword))
      .filter(Boolean)
      .map((keyword) => this.buildXQuery(keyword, input));

    return this.unique([...userQueries, ...domainQueries]);
  }

  /**
   * Builds a valid X API query.
   *
   * Adds:
   * - Retweet exclusion.
   * - Quote exclusion.
   * - Link exclusion.
   * - Optional language filter.
   *
   * @param query Base query text.
   * @param input Collection request context.
   * @returns X search query.
   */
  private buildXQuery(query: string, input: CollectorInput): string {
    const languageCode = CollectorLanguageUtil.resolveLanguageCode(
      input.language,
    );

    const parts = [
      this.normalizeQuery(query),
      '-is:retweet',
      '-is:quote',
      '-has:links',
    ];

    if (languageCode) {
      parts.push(`lang:${languageCode}`);
    }

    return parts.join(' ');
  }

  /**
   * Performs lightweight validation before mapping posts.
   *
   * @param post Raw X post object.
   * @returns True if the post is valid for collection.
   */
  private isValidPost(post: any): boolean {
    const content = this.normalizeText(post?.text ?? '');
    const blockedWords = this.getBlockedWords();

    return (
      Boolean(post?.id) &&
      content.length >= 60 &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  /**
   * Checks whether the post matches the requested domain and language.
   *
   * @param post Raw X post object.
   * @param input Collection request context.
   * @returns True if the post matches the requested context.
   */
  private matchesInputContext(post: any, input: CollectorInput): boolean {
    const content = this.normalizeText(post?.text ?? '');

    if (
      !CollectorLanguageUtil.matchesRequestedLanguage(content, input.language)
    ) {
      return false;
    }

    return this
      .getDomainKeywords(input)
      .some((keyword) => content.includes(keyword));
  }

  /**
   * Calculates a lightweight relevance score before applying storage limits.
   *
   * @param post Raw X post object.
   * @param input Collection request context.
   * @returns Numeric relevance score.
   */
  private calculatePostRelevanceScore(post: any, input: CollectorInput): number {
    const metrics = post.public_metrics ?? {};

    return RelevanceScoreUtil.scoreText({
      title: post.text,
      body: post.text,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: metrics.like_count ?? 0,
      replies: metrics.reply_count ?? 0,
      shares: (metrics.retweet_count ?? 0) + (metrics.quote_count ?? 0),
      publishedAt: post.created_at ? new Date(post.created_at) : undefined,
    });
  }

  /**
   * Maps an X post into the common CollectorPost format.
   *
   * @param post Raw X post object.
   * @param users Included X users mapped by user ID.
   * @param input Collection request context.
   * @returns Normalized collector post.
   */
  private mapXPostToCollectorPost(
    post: any,
    users: Map<string, any>,
    input: CollectorInput,
  ): CollectorPost {
    const author = post.author_id ? users.get(post.author_id) : undefined;
    const metrics = post.public_metrics ?? {};

    return {
      sourceType: CollectionSourceType.X,
      platformName: this.platformName,
      externalId: post.id,
      title: this.buildPostTitle(post.text),
      content: post.text,
      author: author?.username ? `@${author.username}` : post.author_id,
      url: author?.username
        ? `https://x.com/${author.username}/status/${post.id}`
        : `https://x.com/i/web/status/${post.id}`,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language ?? post.lang,
      likesCount: metrics.like_count ?? 0,
      repliesCount: metrics.reply_count ?? 0,
      publishedAt: post.created_at ? new Date(post.created_at) : undefined,
      comments: [],
    };
  }

  /**
   * Reads common blocked words and X-specific blocked words.
   *
   * @returns A normalized list of blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('X_BLOCKED_WORDS');
  }

  /**
   * Maps included users from X API response by user ID.
   *
   * @param users Raw included users.
   * @returns Map of user ID to user object.
   */
  private mapIncludedUsers(users: any[]): Map<string, any> {
    const map = new Map<string, any>();

    users.forEach((user: any) => {
      if (user?.id) map.set(user.id, user);
    });

    return map;
  }

  /**
   * Builds a short readable title from post text.
   *
   * @param text Original post text.
   * @returns Short post title.
   */
  private buildPostTitle(text: string): string {
    const cleanText = text.replace(/\s+/g, ' ').trim();

    if (cleanText.length <= 80) return cleanText;

    return `${cleanText.slice(0, 77)}...`;
  }

  /**
   * Normalizes a query before sending it to X API.
   *
   * @param query Raw query text.
   * @returns Normalized query text.
   */
  private normalizeQuery(query: string): string {
    return this.normalizeText(query);
  }

  /**
   * Builds X request headers using the shared header utility.
   *
   * Keeps the previous validation behavior:
   * - Requires X_API_KEY.
   * - Requires X_API_SECRET.
   * - Requires X_BEARER_TOKEN.
   *
   * The request itself uses Bearer authentication.
   *
   * @returns X API request headers.
   */
  private buildHeaders(): Record<string, string> {
    const bearerToken = this.configService.get<string>('X_BEARER_TOKEN');
    const apiKey = this.configService.get<string>('X_API_KEY');
    const apiSecret = this.configService.get<string>('X_API_SECRET');

    if (!apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'X API key or secret is missing. Please set X_API_KEY and X_API_SECRET in environment variables.',
      );
    }

    if (!bearerToken) {
      throw new ServiceUnavailableException(
        'X bearer token is missing. Please set X_BEARER_TOKEN in environment variables.',
      );
    }

    return CollectorHeaderUtil.bearer(bearerToken);
  }
}