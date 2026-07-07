import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

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

type DevToArticle = {
  id?: number;
  title?: string;
  description?: string;
  url?: string;
  user?: {
    name?: string;
    username?: string;
  };
  public_reactions_count?: number;
  comments_count?: number;
  published_at?: string;
};

type DevToComment = {
  id?: number;
  id_code?: string;
  body_html?: string;
  user?: {
    name?: string;
    username?: string;
  };
  created_at?: string;
};

/**
 * Blog collector.
 *
 * Collects public blog articles from:
 * - RSS feeds.
 * - Dev.to public API.
 *
 * Notes:
 * - RSS feeds usually do not expose comments or likes.
 * - Dev.to provides article metadata, reactions, and public comments.
 *
 * @author Malak
 */
@Injectable()
export class BlogCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.BLOG;

  private readonly platformName = 'Blog';
  private readonly parser = new Parser();

  constructor(configService: ConfigService) {
    super(configService, BlogCollector.name);
  }

  /**
   * Collects blog articles, removes duplicates, ranks them,
   * and returns the most relevant posts.
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

      const rssPosts = await this.collectFromRssFeeds(input);
      const devToPosts = await this.collectFromDevTo(input);

      const collectedPosts = [...rssPosts, ...devToPosts];
      const seenPostIds = new Set<string>();

      const rankedPosts = collectedPosts
        .filter((post) => {
          const key = `${post.platformName}-${post.externalId}-${post.url}`;

          if (seenPostIds.has(key)) return false;

          seenPostIds.add(key);
          return true;
        })
        .map((post) => ({
          post,
          score: this.calculatePostRelevanceScore(post, input),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts)
        .map((item) => item.post);

      this.logger.log(`Blog collection completed. Posts: ${rankedPosts.length}`);

      return rankedPosts;
    } catch (error: unknown) {
      this.logger.warn(
        'Blog collection failed',
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  /**
   * Collects blog articles from RSS feeds selected by domain.
   */
  private async collectFromRssFeeds(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const feeds = this.getFeedsForDomain(input.domainName);
    const collectedPosts: CollectorPost[] = [];

    for (const feedUrl of feeds) {
      const posts = await this.collectFromFeed(feedUrl, input);

      collectedPosts.push(...posts);

      if (collectedPosts.length >= this.maxSavedPosts) {
        break;
      }
    }

    return collectedPosts;
  }

  /**
   * Collects articles from a single RSS feed.
   */
  private async collectFromFeed(
    feedUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const feed = await this.parser.parseURL(feedUrl);

      return (feed.items ?? [])
        .filter((item) => this.isValidRssArticle(item as RssItem))
        .slice(0, this.maxFetchedPosts)
        .map((item): CollectorPost => {
          const rssItem = item as RssItem;

          return {
            sourceType: CollectionSourceType.BLOG,
            platformName: `${this.platformName} - RSS`,
            externalId: rssItem.guid ?? rssItem.link ?? rssItem.title ?? '',
            title: rssItem.title,
            content: this.stripHtml(
              rssItem.contentSnippet ??
                rssItem.content ??
                rssItem.summary ??
                rssItem.title ??
                '',
            ),
            author: rssItem.creator ?? rssItem.author ?? feed.title,
            url: rssItem.link,

            country: input.country,
            city: input.city,
            region: input.region,

            language: input.language,
            likesCount: 0,
            repliesCount: 0,
            publishedAt: rssItem.isoDate
              ? new Date(rssItem.isoDate)
              : rssItem.pubDate
                ? new Date(rssItem.pubDate)
                : undefined,
            comments: [],
          };
        });
    } catch (error: unknown) {
      this.logger.warn(
        `Blog feed skipped: ${feedUrl} - ${
          error instanceof Error ? error.message : error
        }`,
      );

      return [];
    }
  }

  /**
   * Collects public articles from Dev.to API.
   */
  private async collectFromDevTo(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const tag = this.buildDevToTag(input);

      if (!tag) return [];

      const cacheKey = CollectorCacheUtil.build('blog', 'devto-articles', [
        tag,
        input.country,
        input.language,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<DevToArticle[]>(
        'https://dev.to/api/articles',
        {
          headers: this.buildHeaders(),
          params: {
            tag,
            per_page: Math.min(this.maxFetchedPosts, 30),
            top: 7,
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

      return (data ?? [])
        .filter((article) => this.isValidDevToArticle(article))
        .slice(0, this.maxFetchedPosts)
        .map((article) => this.mapDevToArticle(article, input))
        .reduce<Promise<CollectorPost[]>>(
          async (promise, postPromise) => [
            ...(await promise),
            await postPromise,
          ],
          Promise.resolve([]),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Dev.to collection skipped - ${
          error instanceof Error ? error.message : error
        }`,
      );
      return [];
    }
  }

  /**
   * Maps a Dev.to article to the shared CollectorPost format.
   */
  private async mapDevToArticle(
    article: DevToArticle,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectDevToComments(article.id ?? 0);

    return {
      sourceType: CollectionSourceType.BLOG,
      platformName: `${this.platformName} - Dev.to`,
      externalId: String(article.id),
      title: article.title,
      content: this.stripHtml(article.description ?? article.title ?? ''),
      author: article.user?.name ?? article.user?.username,
      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: article.public_reactions_count ?? 0,
      repliesCount: article.comments_count ?? comments.length,
      publishedAt: article.published_at
        ? new Date(article.published_at)
        : undefined,
      comments,
    };
  }

  /**
   * Collects public comments for a Dev.to article.
   */
  private async collectDevToComments(
    articleId: number,
  ): Promise<CollectorComment[]> {
    if (!articleId) return [];

    try {
      const cacheKey = CollectorCacheUtil.build('blog', 'devto-comments', [
        articleId,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<DevToComment[]>(
        'https://dev.to/api/comments',
        {
          headers: this.buildHeaders(),
          params: {
            a_id: articleId,
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

      const seenCommentIds = new Set<string>();

      return (data ?? [])
        .filter((comment) => this.isUsefulComment(comment.body_html))
        .filter((comment) => {
          const id = comment.id_code ?? comment.id?.toString();

          if (!id || seenCommentIds.has(id)) return false;

          seenCommentIds.add(id);
          return true;
        })
        .slice(0, this.maxSavedComments)
        .map((comment): CollectorComment => ({
          externalId: comment.id_code ?? comment.id?.toString() ?? '',
          content: this.stripHtml(comment.body_html ?? ''),
          author: comment.user?.name ?? comment.user?.username,
          likesCount: 0,
          publishedAt: comment.created_at
            ? new Date(comment.created_at)
            : undefined,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Builds the general search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const userKeyword = input.keywords?.[0]
      ? this.normalizeText(input.keywords[0])
      : '';

    if (userKeyword) return userKeyword;

    if (input.domainName) {
      return this.normalizeText(input.domainName);
    }

    return this.getDomainKeywords(input)[0] ?? '';
  }

  /**
   * Builds a Dev.to compatible tag from domain or keywords.
   */
  private buildDevToTag(input: CollectorInput): string {
    const keywords = [
      ...(input.keywords ?? []),
      input.domainName ?? '',
      ...this.getDomainKeywords(input),
    ]
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const tagMap: Record<string, string> = {
      education: 'education',
      healthcare: 'health',
      health: 'health',
      finance: 'finance',
      financial: 'finance',
      cybersecurity: 'security',
      security: 'security',
      technology: 'technology',
      tech: 'technology',
      ai: 'ai',
      artificial: 'ai',
      intelligence: 'ai',
      'artificial intelligence': 'ai',
      machine: 'machinelearning',
      learning: 'machinelearning',
      'machine learning': 'machinelearning',
      software: 'programming',
      programming: 'programming',
      web: 'webdev',
      website: 'webdev',
      backend: 'backend',
      frontend: 'frontend',
      mobile: 'mobile',
      database: 'database',
    };

    for (const keyword of keywords) {
      if (tagMap[keyword]) return tagMap[keyword];

      const compactKeyword = keyword.replace(/\s+/g, '');

      if (tagMap[compactKeyword]) return tagMap[compactKeyword];
    }

    return 'programming';
  }

  /**
   * Validates RSS articles before mapping.
   */
  private isValidRssArticle(item: RssItem): boolean {
    const title = this.normalizeText(item.title ?? '');
    const content = this.normalizeText(
      item.contentSnippet ?? item.content ?? item.summary ?? '',
    );

    if (!title || !item.link || content.length < 80) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    const blockedWords = this.getBlockedWords();
    const text = `${title} ${content}`;

    return !blockedWords.some((word) => text.includes(word));
  }

  /**
   * Validates Dev.to articles before mapping.
   */
  private isValidDevToArticle(article: DevToArticle): boolean {
    const title = this.normalizeText(article.title ?? '');
    const description = this.normalizeText(article.description ?? '');
    const text = `${title} ${description}`;

    if (!article.id || !article.url || !title) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => text.includes(word));
  }

  /**
   * Filters short, low-value, empty, or blocked comments.
   */
  private isUsefulComment(content?: string): boolean {
    const text = this.normalizeText(this.stripHtml(content ?? ''));

    if (text.length < 30) {
      return false;
    }

    const cleaned = text.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    const lowValueComments = new Set([
      'thanks',
      'thank you',
      'great',
      'good',
      'nice',
      'awesome',
      'love it',
      'same',
      'me too',
      'first',
    ]);

    if (lowValueComments.has(text)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => text.includes(word));
  }

  /**
   * Calculates relevance score for collected blog posts.
   */
  private calculatePostRelevanceScore(
    post: CollectorPost,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post.title ?? '',
      body: post.content ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.likesCount ?? 0,
      replies: post.repliesCount ?? 0,
      publishedAt: post.publishedAt,
    });
  }

  /**
   * Returns RSS feeds based on selected domain.
   */
  private getFeedsForDomain(domainName?: string): string[] {
    const domain = this.normalizeText(domainName ?? '');

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
   * Reads common blocked words and Blog-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('BLOG_BLOCKED_WORDS');
  }

  /**
   * Builds headers for public blog APIs.
   */
  private buildHeaders(): Record<string, string> {
    return {
      ...CollectorHeaderUtil.json(),
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }
}