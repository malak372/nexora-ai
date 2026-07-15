import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

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
 * Collects public DEV Community articles and comments.
 *
 * @author Malak
 */
@Injectable()
export class DevToCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'dev-to';

  private readonly apiBaseUrl =
    'https://dev.to/api';

  constructor(configService: ConfigService) {
    super(
      configService,
      DevToCollector.name,
    );
  }

  /**
   * Collects, deduplicates, ranks, and maps
   * DEV.to articles.
   */
  async collect(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const searchQueries =
        this.buildSearchQueries(input);

      if (!searchQueries.length) {
        this.logger.warn(
          'DEV.to collection skipped because no search keywords exist.',
        );

        return [];
      }

      const collectedArticles:
        DevToArticle[] = [];

      for (const query of searchQueries) {
        if (
          collectedArticles.length >=
          this.maxFetchedPosts
        ) {
          break;
        }

        const articles =
          await this.searchArticles(query);

        collectedArticles.push(
          ...articles,
        );
      }

      const seenArticleIds =
        new Set<string>();

      const rankedArticles =
        collectedArticles
          .filter((article) =>
            this.isValidArticle(article),
          )
          .filter((article) => {
            const id =
              article.id?.toString();

            if (
              !id ||
              seenArticleIds.has(id)
            ) {
              return false;
            }

            seenArticleIds.add(id);

            return true;
          })
          .map((article) => ({
            article,
            score:
              this.calculateArticleRelevanceScore(
                article,
                input,
              ),
          }))
          .filter(
            (item) => item.score > 0,
          )
          .sort(
            (first, second) =>
              second.score - first.score,
          )
          .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedArticles.map((item) =>
          this.mapArticleToCollectorPost(
            item.article,
            input,
          ),
        ),
      );

      this.logger.log(
        `DEV.to collection completed. Posts: ${posts.length}`,
      );

      return posts;
    } catch (error: unknown) {
      this.logger.error(
        'DEV.to collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'DEV.to collection failed. Check API availability, collector limits, or network connection.',
      );
    }
  }

  /**
   * Searches DEV.to articles by tag.
   */
  private async searchArticles(
    query: string,
  ): Promise<DevToArticle[]> {
    const cacheKey =
      CollectorCacheUtil.build(
        this.sourceKey,
        'articles',
        [query],
      );

    return CollectorHttpUtil
      .getWithRetryAndCache<
        DevToArticle[]
      >(
        `${this.apiBaseUrl}/articles`,
        {
          headers: this.buildHeaders(),

          params: {
            tag: query
              .replace(/\s+/g, '')
              .toLowerCase(),

            per_page: Math.min(
              this.maxFetchedPosts,
              100,
            ),

            top: 7,
          },

          timeout: 10_000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts:
            this.retryAttempts,
          retryDelayMs:
            this.retryDelayMs,
        },
      );
  }

  /**
   * Builds search queries.
   */
  private buildSearchQueries(
    input: CollectorInput,
  ): string[] {
    const domainKeywords =
      this.getDomainKeywords(input);

    const fallbackDomain =
      input.domainName
        ? [
            this.cleanNormalizedText(
              input.domainName,
            ),
          ]
        : [];

    const userKeywords =
      (input.keywords ?? [])
        .map((keyword) =>
          this.cleanNormalizedText(
            keyword,
          ),
        )
        .filter(Boolean);

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ])
      .filter(
        (term) => term.length >= 3,
      )
      .slice(0, 6);
  }

  /**
   * Validates an article.
   */
  private isValidArticle(
    article: DevToArticle,
  ): boolean {
    const title =
      this.cleanPlainText(
        article.title,
      );

    const description =
      this.cleanPlainText(
        article.description,
      );

    const content =
      this.cleanNormalizedText(
        `${title} ${description}`,
      );

    if (
      !article.id ||
      !title ||
      !article.url ||
      content.length < 40
    ) {
      return false;
    }

    const blockedWords =
      this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(
        this.cleanNormalizedText(word),
      ),
    );
  }

  /**
   * Calculates article relevance.
   */
  private calculateArticleRelevanceScore(
    article: DevToArticle,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(
        article.title,
      ),

      body: this.cleanPlainText(
        article.description,
      ),

      domainTerms:
        this.getDomainKeywords(input),

      problemTerms:
        this.getProblemWords(),

      likes:
        article
          .positive_reactions_count ?? 0,

      replies:
        article.comments_count ?? 0,

      publishedAt:
        article.published_at
          ? new Date(
              article.published_at,
            )
          : undefined,
    });
  }

  /**
   * Maps an article to CollectorPost.
   */
  private async mapArticleToCollectorPost(
    article: DevToArticle,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments =
      await this.collectArticleComments(
        article,
      );

    const title =
      this.cleanPlainText(
        article.title,
      );

    return {
      externalId:
        article.id?.toString() ?? '',

      title,

      content:
        this.cleanPlainText(
          article.description,
        ) || title,

      author:
        article.user?.username ??
        article.user?.name,

      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode:
        this.resolveStoredLanguageCode(
          input.language,
        ),

      likesCount:
        article
          .positive_reactions_count ?? 0,

      repliesCount:
        article.comments_count ??
        comments.length,

      publishedAt:
        article.published_at
          ? new Date(
              article.published_at,
            )
          : undefined,

      comments,
    };
  }

  /**
   * Collects public article comments.
   */
  private async collectArticleComments(
    article: DevToArticle,
  ): Promise<CollectorComment[]> {
    if (
      !article.id ||
      !article.comments_count
    ) {
      return [];
    }

    try {
      const cacheKey =
        CollectorCacheUtil.build(
          this.sourceKey,
          'comments',
          [article.id],
        );

      const comments =
        await CollectorHttpUtil
          .getWithRetryAndCache<
            DevToComment[]
          >(
            `${this.apiBaseUrl}/comments`,
            {
              headers:
                this.buildHeaders(),

              params: {
                a_id: article.id,
              },

              timeout: 10_000,
            },
            {
              cacheKey,
              cacheTtlMs:
                this.cacheTtlMs,
              retryAttempts:
                this.retryAttempts,
              retryDelayMs:
                this.retryDelayMs,
            },
          );

      return (comments ?? [])
        .filter((comment) =>
          this.isUsefulComment(comment),
        )
        .slice(
          0,
          this.maxSavedComments,
        )
        .map(
          (
            comment,
          ): CollectorComment => ({
            externalId:
              comment.id_code ??
              comment.id?.toString() ??
              '',

            content:
              this.cleanPlainText(
                comment.body_html ??
                  comment.body_markdown,
              ),

            author:
              comment.user?.username ??
              comment.user?.name,

            likesCount: 0,

            publishedAt:
              comment.created_at
                ? new Date(
                    comment.created_at,
                  )
                : undefined,
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `DEV.to comments collection failed for article ${article.id}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Filters low-value comments.
   */
  private isUsefulComment(
    comment: DevToComment,
  ): boolean {
    const content =
      this.cleanNormalizedText(
        comment.body_html ??
          comment.body_markdown,
      );

    if (
      (!comment.id_code &&
        !comment.id) ||
      content.length < 40
    ) {
      return false;
    }

    const blockedWords =
      this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(
        this.cleanNormalizedText(word),
      ),
    );
  }

  /**
   * Reads DEV.to blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords(
      'DEV_TO_BLOCKED_WORDS',
    );
  }

  /**
   * Builds API headers.
   */
  private buildHeaders(): Record<
    string,
    string
  > {
    return CollectorHeaderUtil.json();
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}