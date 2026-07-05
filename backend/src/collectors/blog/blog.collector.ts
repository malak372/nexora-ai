import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Blog collector.
 *
 * Collects public blog articles from multiple blog-like sources:
 * - RSS feeds.
 * - Dev.to public API.
 *
 * RSS feeds are used as a broad fallback source for articles.
 * Dev.to is used because it provides public article metadata,
 * reactions, and comments.
 *
 * Notes:
 * - RSS feeds usually do not expose comments or likes.
 * - Dev.to can provide article comments and public reactions.
 * - WordPress REST API can be added later for specific WordPress sites.
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
   * Collects blog articles from RSS feeds and Dev.to,
   * removes duplicates, ranks results by relevance,
   * and returns the best posts.
   *
   * @param input Collector input containing domain, keywords, and location.
   * @returns Ranked blog articles with comments when available.
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
    } catch (error: any) {
      this.logger.warn('Blog collection failed', error?.message ?? error);
      return [];
    }
  }

  /**
   * Collects blog articles from RSS feeds selected by domain.
   *
   * RSS is useful for general blog/news content, but it usually
   * does not provide likes or comments.
   *
   * @param input Collector input.
   * @returns Blog posts collected from RSS feeds.
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
   *
   * @param feedUrl RSS feed URL.
   * @param input Collector input.
   * @returns Blog articles from the feed.
   */
  private async collectFromFeed(
    feedUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const feed = await this.parser.parseURL(feedUrl);

      return (feed.items ?? [])
        .filter((item: any) => this.isValidRssArticle(item))
        .slice(0, this.maxFetchedPosts)
        .map((item: any): CollectorPost => ({
          sourceType: CollectionSourceType.BLOG,
          platformName: `${this.platformName} - RSS`,
          externalId: item.guid ?? item.link ?? item.title,
          title: item.title,
          content: this.stripHtml(
            item.contentSnippet ?? item.content ?? item.summary ?? item.title,
          ),
          author: item.creator ?? item.author ?? feed.title,
          url: item.link,

          country: input.country,
          city: input.city,
          region: input.region,

          language: input.language,
          likesCount: 0,
          repliesCount: 0,
          publishedAt: item.isoDate
            ? new Date(item.isoDate)
            : item.pubDate
              ? new Date(item.pubDate)
              : undefined,
          comments: [],
        }));
    } catch (error: any) {
      this.logger.warn(
        `Blog feed skipped: ${feedUrl} - ${error?.message ?? error}`,
      );

      return [];
    }
  }

  /**
   * Collects public articles from Dev.to API.
   *
   * Dev.to is useful because it provides:
   * - Articles.
   * - Public reactions count.
   * - Comments count.
   * - Public comments through a separate endpoint.
   *
   * @param input Collector input.
   * @returns Blog posts collected from Dev.to.
   */
  private async collectFromDevTo(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const tag = this.buildDevToTag(input);

      if (!tag) return [];

      const cacheKey = CollectorCacheUtil.build('blog', 'devto-articles', [
        tag,
        input.country,
        input.language,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any[]>(
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

      const articles = data ?? [];

      const posts = await Promise.all(
        articles
          .filter((article: any) => this.isValidDevToArticle(article))
          .slice(0, this.maxFetchedPosts)
          .map((article: any) => this.mapDevToArticle(article, input)),
      );

      return posts;
    } catch (error: any) {
      this.logger.warn(`Dev.to collection skipped - ${error?.message ?? error}`);
      return [];
    }
  }

  /**
   * Maps a Dev.to article to the shared CollectorPost format.
   *
   * @param article Dev.to article object.
   * @param input Collector input.
   * @returns CollectorPost with comments and reaction counts.
   */
  private async mapDevToArticle(
    article: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectDevToComments(article.id);

    return {
      sourceType: CollectionSourceType.BLOG,
      platformName: `${this.platformName} - Dev.to`,
      externalId: article.id.toString(),
      title: article.title,
      content: this.stripHtml(article.description ?? article.title),
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
   *
   * @param articleId Dev.to article ID.
   * @returns Useful public comments.
   */
  private async collectDevToComments(
    articleId: number,
  ): Promise<CollectorComment[]> {
    try {
      const cacheKey = CollectorCacheUtil.build('blog', 'devto-comments', [
        articleId,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any[]>(
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
        .filter((comment: any) => this.isUsefulComment(comment?.body_html))
        .filter((comment: any) => {
          const id = comment?.id_code ?? comment?.id?.toString();

          if (!id || seenCommentIds.has(id)) return false;

          seenCommentIds.add(id);
          return true;
        })
        .slice(0, this.maxSavedComments)
        .map((comment: any): CollectorComment => ({
          externalId: comment.id_code ?? comment.id?.toString(),
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
   * Builds the general search query used for checking whether
   * the blog collector has enough input to run.
   *
   * @param input Collector input.
   * @returns Search query.
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
   * Builds a Dev.to tag from domain or user keywords.
   *
   * Dev.to works better with technical tags such as:
   * webdev, ai, machinelearning, programming, cybersecurity.
   *
   * @param input Collector input.
   * @returns Dev.to compatible tag.
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
   * Validates RSS article before mapping.
   *
   * @param item RSS item.
   * @returns True if the RSS article is usable.
   */
  private isValidRssArticle(item: any): boolean {
    const title = this.normalizeText(item?.title ?? '');
    const content = this.normalizeText(
      item?.contentSnippet ?? item?.content ?? item?.summary ?? '',
    );

    if (
      !title ||
      !item?.link ||
      content.length < 80
    ) {
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
   * Validates Dev.to article before mapping.
   *
   * @param article Dev.to article object.
   * @returns True if the article is usable.
   */
  private isValidDevToArticle(article: any): boolean {
    const title = this.normalizeText(article?.title ?? '');
    const description = this.normalizeText(article?.description ?? '');
    const text = `${title} ${description}`;

    if (!article?.id || !article?.url || !title) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => text.includes(word));
  }

  /**
   * Validates public comments before saving.
   *
   * @param content Raw comment content.
   * @returns True if the comment is useful.
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
   *
   * @param post Collected blog post.
   * @param input Collector input.
   * @returns Numeric relevance score.
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
   * Returns RSS feeds based on the selected domain.
   *
   * @param domainName Selected domain name.
   * @returns List of RSS feed URLs.
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
   *
   * Environment variable:
   * BLOG_BLOCKED_WORDS
   *
   * @returns List of blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('BLOG_BLOCKED_WORDS');
  }

  /**
   * Builds headers for public blog APIs.
   *
   * @returns HTTP headers.
   */
  private buildHeaders(): Record<string, string> {
    return {
      ...CollectorHeaderUtil.json(),
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }
}