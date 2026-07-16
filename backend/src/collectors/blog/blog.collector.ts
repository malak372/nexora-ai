import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

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
export class BlogCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'blog';

  /**
   * RSS parser instance.
   */
  private readonly parser = new Parser();

  constructor(configService: ConfigService) {
    super(configService, BlogCollector.name);
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

      const rssPosts = await this.collectFromRssFeeds(input);
      const seenPostIds = new Set<string>();

      const rankedPosts = rssPosts
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
      this.logger.warn(
        'Blog collection failed',
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Collects articles from configured RSS feeds.
   */
  private async collectFromRssFeeds(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const feeds = this.getFeedsForDomain(input.domainName);
    const collectedPosts: CollectorPost[] = [];

    for (const feedUrl of feeds) {
      const posts = await this.collectFromFeed(feedUrl, input);

      collectedPosts.push(...posts);

      if (collectedPosts.length >= this.maxFetchedPosts) {
        break;
      }
    }

    return collectedPosts;
  }

  /**
   * Collects articles from one RSS feed.
   */
  private async collectFromFeed(
    feedUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const cacheKey = CollectorCacheUtil.build(
        this.sourceKey,
        'rss-feed',
        [feedUrl],
      );

      const feed = await CollectorExternalCacheUtil.remember(
        cacheKey,
        this.cacheTtlMs,
        () => this.parser.parseURL(feedUrl),
      );

      return (feed.items ?? [])
        .filter((item) =>
          this.isValidRssArticle(item as RssItem),
        )
        .slice(0, this.maxFetchedPosts)
        .map((item): CollectorPost => {
          const rssItem = item as RssItem;

          const title = this.cleanPlainText(rssItem.title);

          return {
            externalId:
              rssItem.guid ??
              rssItem.link ??
              title,

            title,

            content: this.cleanPlainText(
              rssItem.contentSnippet ??
                rssItem.content ??
                rssItem.summary ??
                title,
            ),

            author: this.cleanPlainText(
              rssItem.creator ??
                rssItem.author ??
                feed.title,
            ),

            url: rssItem.link,

            country: input.country,
            city: input.city,
            region: input.region,

            languageCode: this.resolveStoredLanguageCode(
              input.language,
            ),

            likesCount: 0,
            repliesCount: 0,

            publishedAt: this.parseDate(
              rssItem.isoDate ?? rssItem.pubDate,
            ),

            comments: [],
          };
        });
    } catch (error: unknown) {
      this.logger.warn(
        `Blog feed skipped: ${feedUrl} - ${this.getErrorMessage(
          error,
        )}`,
      );

      return [];
    }
  }

  /**
   * Builds the primary blog query.
   */
  private buildSearchQuery(input: CollectorInput): string {
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
      item.contentSnippet ??
        item.content ??
        item.summary,
    );

    if (!title || !item.link || content.length < 80) {
      return false;
    }

    const normalizedContent = this.cleanNormalizedText(
      `${title} ${content}`,
    );

    const cleaned = normalizedContent
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();

    if (!cleaned) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      normalizedContent.includes(
        this.cleanNormalizedText(word),
      ),
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

    return typeof error === 'string'
      ? error
      : 'Unknown Blog collector error.';
  }
}