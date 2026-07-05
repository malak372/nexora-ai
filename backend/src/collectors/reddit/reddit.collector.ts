import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Reddit collector.
 *
 * Collects public Reddit posts and comments using Reddit public JSON endpoints.
 *
 * Notes:
 * - Does not require OAuth.
 * - Works only with public Reddit content.
 * - Reddit does not support accurate country/city filtering.
 *
 * @author Malak
 */
@Injectable()
export class RedditCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.REDDIT;

  private readonly platformName = 'Reddit';
  private readonly baseUrl = 'https://www.reddit.com';

  constructor(configService: ConfigService) {
    super(configService, RedditCollector.name);
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Reddit collection skipped because no search keywords exist.',
        );
        return [];
      }

      const urls = this.buildSearchUrls(input, searchQuery);
      const collectedPosts = new Map<string, CollectorPost>();

      for (const url of urls) {
        const posts = await this.collectFromUrl(url, input);

        for (const post of posts) {
          if (collectedPosts.size >= this.maxSavedPosts) break;
          collectedPosts.set(post.externalId, post);
        }

        if (collectedPosts.size >= this.maxSavedPosts) break;

        await this.delay(700);
      }

      const result = Array.from(collectedPosts.values());

      this.logger.log(`Reddit collection completed. Posts: ${result.length}`);

      return result;
    } catch (error: any) {
      this.logger.error(
        'Reddit collection failed',
        error.response?.data ?? error.message,
      );

      return [];
    }
  }

  private async collectFromUrl(
    url: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const cacheKey = CollectorCacheUtil.build('reddit', 'posts', [
        url,
        input.country,
        input.language,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
        url,
        {
          headers: this.buildHeaders(),
          timeout: 10000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const children = data?.data?.children ?? [];
      const seenPostIds = new Set<string>();

      const rankedPosts = children
        .map((child: any) => child?.data)
        .filter((post: any) => this.isValidPost(post))
        .filter((post: any) => {
          const id = post?.id?.toString();

          if (!id || seenPostIds.has(id)) return false;

          seenPostIds.add(id);
          return true;
        })
        .map((post: any) => ({
          post,
          score: this.calculatePostRelevanceScore(post, input),
        }))
        //.filter((item: any) => item.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      return Promise.all(
        rankedPosts.map((item: any) =>
          this.mapRedditPostToCollectorPost(item.post, input),
        ),
      );
    } catch (error: any) {
      this.logger.warn(
        `Reddit URL skipped: ${url} - ${error.response?.status ?? error.message}`,
      );

      return [];
    }
  }

  private buildSearchUrls(
    input: CollectorInput,
    searchQuery: string,
  ): string[] {
    const encodedQuery = encodeURIComponent(searchQuery);
    const urls: string[] = [];

    urls.push(
      `${this.baseUrl}/search.json?q=${encodedQuery}&sort=relevance&limit=${this.maxFetchedPosts}`,
    );

    const subreddits = this.getSubredditsForDomain(input.domainName);

    for (const subreddit of subreddits.slice(0, 5)) {
      urls.push(
        `${this.baseUrl}/r/${subreddit}/search.json?q=${encodedQuery}&restrict_sr=1&sort=relevance&limit=${this.maxFetchedPosts}`,
      );
    }

    return urls;
  }

  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([...domainKeywords, ...fallbackDomain, ...userKeywords])
      .slice(0, 4)
      .join(' ');
  }

  private isValidPost(post: any): boolean {
    const title = post?.title ?? '';
    const body = post?.selftext ?? '';
    const author = post?.author ?? '';
    const content = this.normalizeText(`${title} ${body}`);
    const blockedWords = this.getBlockedWords();

    return (
      Boolean(post?.id) &&
      Boolean(post?.title) &&
      Boolean(post?.permalink) &&
      author !== '[deleted]' &&
      post.removed_by_category == null &&
      post.over_18 !== true &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  private calculatePostRelevanceScore(
    post: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post?.title ?? '',
      body: post?.selftext ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.ups ?? post.score ?? 0,
      replies: post.num_comments ?? 0,
      publishedAt: post.created_utc
        ? new Date(post.created_utc * 1000)
        : undefined,
    });
  }

  private async mapRedditPostToCollectorPost(
    post: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectPostComments(post);

    return {
      sourceType: CollectionSourceType.REDDIT,
      platformName: this.platformName,
      externalId: post.id.toString(),
      title: post.title,
      content: this.buildPostContent(post),
      author: post.author,
      url: `${this.baseUrl}${post.permalink}`,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: post.ups ?? post.score ?? 0,
      repliesCount: post.num_comments ?? comments.length,
      publishedAt: post.created_utc
        ? new Date(post.created_utc * 1000)
        : undefined,
      comments,
    };
  }

  private async collectPostComments(post: any): Promise<CollectorComment[]> {
    if (!post?.permalink) return [];

    try {
      const commentsUrl = `${this.baseUrl}${post.permalink}.json?limit=${this.maxFetchedComments}`;

      const cacheKey = CollectorCacheUtil.build('reddit', 'comments', [
        post.id,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
        commentsUrl,
        {
          headers: this.buildHeaders(),
          timeout: 10000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const commentChildren = data?.[1]?.data?.children ?? [];
      const seenCommentIds = new Set<string>();

      return commentChildren
        .map((child: any) => child?.data)
        .filter((comment: any) => this.isUsefulComment(comment))
        .filter((comment: any) => {
          const id = comment?.id?.toString();

          if (!id || seenCommentIds.has(id)) return false;

          seenCommentIds.add(id);
          return true;
        })
        .slice(0, this.maxSavedComments)
        .map((comment: any): CollectorComment => ({
          externalId: comment.id.toString(),
          content: comment.body,
          author: comment.author,
          likesCount: comment.ups ?? comment.score ?? 0,
          publishedAt: comment.created_utc
            ? new Date(comment.created_utc * 1000)
            : undefined,
        }));
    } catch (error: any) {
  this.logger.warn(
    `Reddit comments skipped for post ${post.id} - ${
      error.response?.status ?? error.message
    }`,
  );

  return [];
}
  }

  private isUsefulComment(comment: any): boolean {
    const author = comment?.author ?? '';
    const content = this.normalizeText(comment?.body ?? '');

    if (
      !comment?.id ||
      content.length < 20 ||
      content === '[deleted]' ||
      content === '[removed]' ||
      author === '[deleted]'
    ) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  private buildPostContent(post: any): string {
    return [post.title, post.selftext].filter(Boolean).join('\n\n');
  }

  private getSubredditsForDomain(domainName?: string): string[] {
    const domain = this.normalizeText(domainName ?? '');

    const dictionary: Record<string, string[]> = {
      education: [
        'education',
        'Teachers',
        'college',
        'students',
        'edtech',
        'AskAcademia',
      ],
      healthcare: ['healthcare', 'medicine', 'HealthIT'],
      finance: ['personalfinance', 'fintech', 'banking'],
      agriculture: ['farming', 'Agriculture'],
      tourism: ['travel', 'solotravel'],
      'e-commerce': ['ecommerce', 'shopify', 'smallbusiness'],
      cybersecurity: ['cybersecurity', 'netsec', 'privacy'],
      'artificial intelligence': [
        'ArtificialInteligence',
        'MachineLearning',
        'LocalLLaMA',
      ],
      other: ['technology', 'software', 'programming'],
    };

    return dictionary[domain] ?? ['technology', 'software', 'programming'];
  }

  protected getBlockedWords(): string[] {
    return super.getBlockedWords('REDDIT_BLOCKED_WORDS');
  }

  private buildHeaders(): Record<string, string> {
    return {
      'User-Agent':
        this.configService.get<string>('REDDIT_USER_AGENT') ??
        'NexoraAI/1.0.0 academic-project by Malak',
      Accept: 'application/json',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}