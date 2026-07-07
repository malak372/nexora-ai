import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

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

type DevToUser = {
  username?: string;
  name?: string;
};

type DevToArticle = {
  id?: number;
  title?: string;
  description?: string;
  url?: string;
  positive_reactions_count?: number;
  comments_count?: number;
  published_at?: string;
  user?: DevToUser;
};

type DevToComment = {
  id?: number;
  id_code?: string;
  body_html?: string;
  body_markdown?: string;
  created_at?: string;
  user?: DevToUser;
};

/**
 * DEV.to collector.
 *
 * Collects public DEV Community articles and comments using the DEV API.
 *
 * @author Malak
 */
@Injectable()
export class DevToCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.DEV_TO;

  private readonly platformName = 'DEV.to';
  private readonly apiBaseUrl = 'https://dev.to/api';

  constructor(configService: ConfigService) {
    super(configService, DevToCollector.name);
  }

  /**
   * Collects DEV.to articles, removes duplicates, ranks them,
   * and maps them into the unified CollectorPost format.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQueries = this.buildSearchQueries(input);

      if (!searchQueries.length) {
        this.logger.warn(
          'DEV.to collection skipped because no search keywords exist.',
        );
        return [];
      }

      const collectedArticles: DevToArticle[] = [];

      for (const query of searchQueries) {
        if (collectedArticles.length >= this.maxFetchedPosts) break;

        const articles = await this.searchArticles(query);
        collectedArticles.push(...articles);
      }

      const seenArticleIds = new Set<string>();

      const rankedArticles = collectedArticles
        .filter((article) => this.isValidArticle(article))
        .filter((article) => {
          const id = article.id?.toString();

          if (!id || seenArticleIds.has(id)) return false;

          seenArticleIds.add(id);
          return true;
        })
        .map((article) => ({
          article,
          score: this.calculateArticleRelevanceScore(article, input),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts: CollectorPost[] = [];

      for (const item of rankedArticles) {
        posts.push(await this.mapArticleToCollectorPost(item.article, input));
      }

      this.logger.log(`DEV.to collection completed. Posts: ${posts.length}`);

      return posts;
    } catch (error: unknown) {
      this.logger.error('DEV.to collection failed', this.getErrorMessage(error));

      throw new ServiceUnavailableException(
        'DEV.to collection failed. Check collector limits, API availability, or network connection.',
      );
    }
  }

  /**
   * Searches DEV.to articles by tag.
   */
  private async searchArticles(query: string): Promise<DevToArticle[]> {
    const cacheKey = CollectorCacheUtil.build('dev-to', 'articles', [query]);

    return CollectorHttpUtil.getWithRetryAndCache<DevToArticle[]>(
      `${this.apiBaseUrl}/articles`,
      {
        headers: this.buildHeaders(),
        params: {
          tag: query.replace(/\s+/g, '').toLowerCase(),
          per_page: Math.min(this.maxFetchedPosts, 100),
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
  }

  /**
   * Builds search queries from user keywords, domain keywords, and domain name.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ])
      .filter((term) => term.length >= 3)
      .slice(0, 6);
  }

  /**
   * Validates a DEV.to article before ranking and mapping.
   */
  private isValidArticle(article: DevToArticle): boolean {
    const title = article.title ?? '';
    const description = article.description ?? '';
    const content = this.normalizeText(`${title} ${description}`);
    const blockedWords = this.getBlockedWords();

    if (!article.id || !title || !article.url || content.length < 40) {
      return false;
    }

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Calculates article relevance score using the shared scoring utility.
   */
  private calculateArticleRelevanceScore(
    article: DevToArticle,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: article.title ?? '',
      body: article.description ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: article.positive_reactions_count ?? 0,
      replies: article.comments_count ?? 0,
      publishedAt: article.published_at
        ? new Date(article.published_at)
        : undefined,
    });
  }

  /**
   * Maps a DEV.to article to the unified CollectorPost format.
   */
  private async mapArticleToCollectorPost(
    article: DevToArticle,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectArticleComments(article);

    return {
      sourceType: CollectionSourceType.DEV_TO,
      platformName: this.platformName,
      externalId: article.id?.toString() ?? '',
      title: article.title,
      content: article.description ?? article.title ?? '',
      author: article.user?.username ?? article.user?.name,
      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: article.positive_reactions_count ?? 0,
      repliesCount: article.comments_count ?? comments.length,
      publishedAt: article.published_at
        ? new Date(article.published_at)
        : undefined,
      comments,
    };
  }

  /**
   * Collects public comments for a DEV.to article.
   */
  private async collectArticleComments(
    article: DevToArticle,
  ): Promise<CollectorComment[]> {
    if (!article.id || !article.comments_count) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build('dev-to', 'comments', [
        article.id,
      ]);

      const comments = await CollectorHttpUtil.getWithRetryAndCache<
        DevToComment[]
      >(
        `${this.apiBaseUrl}/comments`,
        {
          headers: this.buildHeaders(),
          params: {
            a_id: article.id,
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

      return (comments ?? [])
        .filter((comment) => this.isUsefulComment(comment))
        .slice(0, this.maxSavedComments)
        .map((comment): CollectorComment => ({
          externalId: comment.id_code ?? comment.id?.toString() ?? '',
          content: this.stripHtml(comment.body_html ?? comment.body_markdown ?? ''),
          author: comment.user?.username ?? comment.user?.name,
          likesCount: 0,
          publishedAt: comment.created_at
            ? new Date(comment.created_at)
            : undefined,
        }));
    } catch (error: unknown) {
      this.logger.warn(
        `DEV.to comments collection failed for article ${article.id}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Filters short, invalid, or blocked comments.
   */
  private isUsefulComment(comment: DevToComment): boolean {
    const content = this.normalizeText(
      this.stripHtml(comment.body_html ?? comment.body_markdown ?? ''),
    );

    if (!comment.id_code && !comment.id) return false;

    if (content.length < 40) return false;

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Reads common blocked words and DEV.to-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('DEV_TO_BLOCKED_WORDS');
  }

  /**
   * Builds DEV.to API headers.
   */
  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
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