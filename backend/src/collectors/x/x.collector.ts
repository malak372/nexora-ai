import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorQueryBuilderUtil } from '../base/collector-query-builder.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

type XPublicMetrics = {
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
};

type XTweet = {
  id?: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  lang?: string;
  conversation_id?: string;
  public_metrics?: XPublicMetrics;
};

type XUser = {
  id?: string;
  name?: string;
  username?: string;
  location?: string;
};

type XSearchResponse = {
  data?: XTweet[];
  includes?: {
    users?: XUser[];
  };
};

/**
 * X collector.
 *
 * Collects public X posts using X API v2 Search.
 *
 * Notes:
 * - Uses CollectorHttpUtil for retry and cache.
 * - Requires X_BEARER_TOKEN.
 * - X_API_KEY and X_API_SECRET are optional unless your setup needs them.
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
   * Collects public X posts based on selected domain and user keywords.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const queries = this.buildSearchQueries(input).slice(
      0,
      this.maxSearchQueries,
    );

    if (!queries.length) {
      this.logger.warn('X collection skipped because no search keywords exist.');
      return [];
    }

    const collectedPosts: CollectorPost[] = [];
    const seenPostIds = new Set<string>();

    try {
      for (const query of queries) {
        if (collectedPosts.length >= this.maxSavedPosts) {
          break;
        }

        const response = await this.searchPosts(input, query);
        const posts = response.data ?? [];
        const users = this.mapIncludedUsers(response.includes?.users ?? []);

        const rankedPosts = posts
          .filter((post) => this.isValidPost(post))
          .filter((post) => this.matchesInputLanguage(post, input))
          .map((post) => ({
            post,
            score: this.calculatePostRelevanceScore(post, input),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);

        for (const item of rankedPosts) {
          if (collectedPosts.length >= this.maxSavedPosts) {
            break;
          }

          const post = item.post;

          if (!post.id || seenPostIds.has(post.id)) {
            continue;
          }

          seenPostIds.add(post.id);
          collectedPosts.push(this.mapXPostToCollectorPost(post, users, input));
        }
      }

      this.logger.log(`X collection completed. Posts: ${collectedPosts.length}`);

      return collectedPosts;
    } catch (error: unknown) {
      this.logger.warn('X collection failed', this.getErrorMessage(error));

      return [];
    }
  }

  /**
   * Searches X posts using the configured search mode.
   */
  private async searchPosts(
    input: CollectorInput,
    query: string,
  ): Promise<XSearchResponse> {
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

    return CollectorHttpUtil.getWithRetryAndCache<XSearchResponse>(
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
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeQuery(keyword))
      .filter(Boolean);

    if (!domainKeywords.length && !userKeywords.length) {
      return [];
    }

    const problemWords = this.getProblemWords();

    const domainQueries = domainKeywords.length
      ? CollectorQueryBuilderUtil.buildProblemQueries(
          domainKeywords,
          problemWords,
        ).map((query) => this.buildXQuery(query, input))
      : [];

    const userQueries = userKeywords.map((keyword) =>
      this.buildXQuery(keyword, input),
    );

    return this.unique([...userQueries, ...domainQueries]);
  }

  /**
   * Builds a valid X API query.
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
      parts.push(`lang:${languageCode.toLowerCase()}`);
    }

    return parts.join(' ');
  }

  /**
   * Performs lightweight validation before mapping posts.
   */
  private isValidPost(post: XTweet): boolean {
    const content = this.normalizeText(post.text ?? '');
    const blockedWords = this.getBlockedWords();

    return (
      Boolean(post.id) &&
      content.length >= 60 &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  /**
   * Checks whether the post matches the requested language.
   *
   * Domain relevance is handled by RelevanceScoreUtil instead
   * of strict keyword rejection.
   */
  private matchesInputLanguage(post: XTweet, input: CollectorInput): boolean {
    return CollectorLanguageUtil.matchesRequestedLanguage(
      post.text ?? '',
      input.language,
    );
  }

  /**
   * Calculates relevance score before applying storage limits.
   */
  private calculatePostRelevanceScore(
    post: XTweet,
    input: CollectorInput,
  ): number {
    const metrics = post.public_metrics ?? {};

    return RelevanceScoreUtil.scoreText({
      title: post.text ?? '',
      body: post.text ?? '',
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
   */
  private mapXPostToCollectorPost(
    post: XTweet,
    users: Map<string, XUser>,
    input: CollectorInput,
  ): CollectorPost {
    const author = post.author_id ? users.get(post.author_id) : undefined;
    const metrics = post.public_metrics ?? {};

    return {
      sourceType: CollectionSourceType.X,
      platformName: this.platformName,
      externalId: post.id ?? '',
      title: this.buildPostTitle(post.text ?? ''),
      content: post.text ?? '',
      author: author?.username ? `@${author.username}` : post.author_id,
      url: author?.username
        ? `https://x.com/${author.username}/status/${post.id}`
        : `https://x.com/i/web/status/${post.id}`,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: metrics.like_count ?? 0,
      repliesCount: metrics.reply_count ?? 0,
      publishedAt: post.created_at ? new Date(post.created_at) : undefined,
      comments: [],
    };
  }

  /**
   * Reads common blocked words and X-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('X_BLOCKED_WORDS');
  }

  /**
   * Maps included users from X API response by user ID.
   */
  private mapIncludedUsers(users: XUser[]): Map<string, XUser> {
    const map = new Map<string, XUser>();

    users.forEach((user) => {
      if (user.id) {
        map.set(user.id, user);
      }
    });

    return map;
  }

  /**
   * Builds a short readable title from post text.
   */
  private buildPostTitle(text: string): string {
    const cleanText = text.replace(/\s+/g, ' ').trim();

    if (cleanText.length <= 80) {
      return cleanText;
    }

    return `${cleanText.slice(0, 77)}...`;
  }

  /**
   * Normalizes a query before sending it to X API.
   */
  private normalizeQuery(query: string): string {
    return this.normalizeText(query);
  }

  /**
   * Builds X request headers.
   */
  private buildHeaders(): Record<string, string> {
    const bearerToken = this.configService.get<string>('X_BEARER_TOKEN');

    if (!bearerToken) {
      throw new ServiceUnavailableException(
        'X bearer token is missing. Please set X_BEARER_TOKEN in environment variables.',
      );
    }

    return CollectorHeaderUtil.bearer(bearerToken);
  }

  /**
   * Extracts readable message from unknown errors.
   */
  private getErrorMessage(error: unknown): unknown {
    if (error instanceof Error) {
      return error.message;
    }

    return error;
  }
}