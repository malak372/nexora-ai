import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Represents an RSS feed item used by the Blog collector.
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
 * Collects public blog articles from RSS feeds only.
 *
 * Dev.to is handled by DevToCollector to avoid:
 * - Duplicate posts.
 * - Duplicate comments.
 * - Duplicate NLP analysis.
 *
 * Notes:
 * - RSS feeds usually do not expose comments or likes.
 *
 * @author Malak
 */
@Injectable()
export class BlogCollector extends BaseCollector implements SocialCollector {
  /**
   * Platform source type stored with collected records.
   */
  readonly sourceType = CollectionSourceType.BLOG;

  /**
   * Human-readable platform name.
   */
  private readonly platformName = 'Blog';

  /**
   * RSS parser used to fetch and parse public feeds.
   */
  private readonly parser = new Parser();

  constructor(configService: ConfigService) {
    super(configService, BlogCollector.name);
  }

  /**
   * Collects blog articles, removes duplicates, ranks them,
   * and returns the most relevant posts.
   *
   * @param input Collection job configuration.
   * @returns Relevant blog posts.
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

      const seenPostIds = new Set<string>();

      const rankedPosts = rssPosts
        .filter((post) => {
          const key = `${post.platformName}-${post.externalId}-${post.url}`;

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
   * Collects blog articles from RSS feeds selected
   * according to the requested domain.
   *
   * @param input Collection job configuration.
   * @returns Collected RSS posts.
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
   * Collects articles from one RSS feed.
   *
   * @param feedUrl Public RSS feed URL.
   * @param input Collection job configuration.
   * @returns Collected posts from the feed.
   */
  private async collectFromFeed(
    feedUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const cacheKey = CollectorCacheUtil.build('blog', 'rss-feed', [feedUrl]);

      const feed = await CollectorExternalCacheUtil.remember(
        cacheKey,
        this.cacheTtlMs,
        () => this.parser.parseURL(feedUrl),
      );

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
            content: this.cleanPlainText(
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
        `Blog feed skipped: ${feedUrl} - ${this.getErrorMessage(error)}`,
      );

      return [];
    }
  }

  /**
   * Builds the primary blog search query.
   *
   * Priority:
   * 1. First custom keyword.
   * 2. Domain name.
   * 3. First configured domain keyword.
   *
   * @param input Collection job configuration.
   * @returns Normalized search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const userKeyword = input.keywords?.[0]
      ? this.normalizeText(input.keywords[0])
      : '';

    if (userKeyword) {
      return userKeyword;
    }

    if (input.domainName) {
      return this.normalizeText(input.domainName);
    }

    return this.getDomainKeywords(input)[0] ?? '';
  }

  /**
   * Validates an RSS article before mapping.
   *
   * @param item RSS feed item.
   * @returns True when the article is useful.
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
   * Calculates relevance score for a collected blog post.
   *
   * @param post Collected blog post.
   * @param input Collection job configuration.
   * @returns Relevance score.
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
   * @param domainName Requested domain name.
   * @returns Matching RSS feed URLs.
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
   * Reads common blocked words and
   * Blog-specific blocked words.
   *
   * @returns Normalized blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('BLOG_BLOCKED_WORDS');
  }

  /**
   * Extracts a readable message from an unknown error.
   *
   * @param error Unknown caught value.
   * @returns Safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown Blog collector error.';
  }
}
