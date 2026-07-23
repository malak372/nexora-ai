import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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

/**
 * Minimal DEV.to user representation returned by the public API.
 *
 * @author Malak
 */
type DevToUser = {
  username?: string;
  name?: string;
};

/**
 * DEV.to article representation used by the collector.
 *
 * The DEV.to API may return `tag_list` as either an array or a
 * comma-separated string depending on the endpoint representation.
 *
 * @author Malak
 */
type DevToArticle = {
  id?: number;
  title?: string;
  description?: string;
  url?: string;
  positive_reactions_count?: number;
  comments_count?: number;
  published_at?: string;
  tag_list?: string[] | string;
  tags?: string;
  user?: DevToUser;
};

/**
 * DEV.to comment representation used by the collector.
 *
 * @author Malak
 */
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
 * Collects publicly available DEV Community articles and comments.
 *
 * Responsibilities:
 * - Build valid DEV.to tag queries.
 * - Search public articles by source tags.
 * - Remove duplicate and invalid articles.
 * - Rank articles by domain relevance.
 * - Preserve source tags for centralized relevance filtering.
 * - Collect useful article comments.
 * - Map external API data into normalized collector contracts.
 *
 * This collector does not persist records directly.
 *
 * @author Malak
 */
@Injectable()
export class DevToCollector extends BaseCollector implements SocialCollector {
  /**
   * Source identifier.
   *
   * Must match the corresponding DataSource.key value.
   */
  readonly sourceKey = 'dev-to';

  /**
   * DEV.to public API base URL.
   */
  private readonly apiBaseUrl = 'https://dev.to/api';

  /**
   * Additional relevance score granted when a DEV.to source tag
   * exactly matches one of the requested relevance terms.
   *
   * DEV.to already classifies articles by source tags, so an exact
   * tag match is stronger evidence than a normal body occurrence.
   */
  private readonly exactTagMatchBonus = 35;

  constructor(configService: ConfigService) {
    super(configService, DevToCollector.name);
  }

  /**
   * Collects, validates, deduplicates, ranks, and maps DEV.to articles.
   *
   * The collector searches several relevant DEV.to tags, combines their
   * results, removes duplicate articles, calculates relevance, and returns
   * the highest-ranked normalized posts.
   *
   * @param input Collection request input.
   * @returns Normalized DEV.to posts and their comments.
   * @throws ServiceUnavailableException When DEV.to collection fails.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQueries = this.buildSearchQueries(input);

      if (!searchQueries.length) {
        this.logger.warn(
          'DEV.to collection skipped because no valid search tags exist.',
        );

        return [];
      }

      const collectedArticles: DevToArticle[] = [];

      for (const query of searchQueries) {
        if (collectedArticles.length >= this.maxFetchedPosts) {
          break;
        }

        const articles = await this.searchArticles(query);

        collectedArticles.push(...articles);
      }

      const seenArticleIds = new Set<string>();

      const rankedArticles = collectedArticles
        .filter((article) => this.isValidArticle(article))
        .filter((article) => {
          const articleId = article.id?.toString();

          if (!articleId || seenArticleIds.has(articleId)) {
            return false;
          }

          seenArticleIds.add(articleId);

          return true;
        })
        .map((article) => ({
          article,
          score: this.calculateArticleRelevanceScore(article, input),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedArticles.map(({ article }) =>
          this.mapArticleToCollectorPost(article, input),
        ),
      );

      this.logger.log(`DEV.to collection completed. Posts: ${posts.length}`);

      return posts;
    } catch (error: unknown) {
      this.logger.error(
        'DEV.to collection failed.',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'DEV.to collection failed. Check API availability, collector limits, or network connection.',
      );
    }
  }

  /**
   * Searches DEV.to articles using a valid source tag.
   *
   * Multi-word values are not passed to this method because DEV.to
   * expects a real tag rather than a general full-text search phrase.
   *
   * @param tag Normalized DEV.to tag.
   * @returns Articles returned by the DEV.to API.
   */
  private async searchArticles(tag: string): Promise<DevToArticle[]> {
    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'articles', [
      tag,
    ]);

    const articles = await CollectorHttpUtil.getWithRetryAndCache<
      DevToArticle[]
    >(
      `${this.apiBaseUrl}/articles`,
      {
        headers: this.buildHeaders(),

        params: {
          tag: tag.toLowerCase(),

          per_page: Math.min(this.maxFetchedPosts, 100),

          top: 7,
        },

        timeout: 10_000,
      },
      {
        cacheKey,
        cacheTtlMs: this.cacheTtlMs,
        retryAttempts: this.retryAttempts,
        retryDelayMs: this.retryDelayMs,
      },
    );

    return articles ?? [];
  }

  /**
   * Builds valid DEV.to search tags.
   *
   * Search terms are built from:
   * - User-provided keywords.
   * - Configured domain keywords.
   * - The selected domain name.
   *
   * Multi-word terms are excluded because removing their spaces would
   * produce an invented DEV.to tag. For example, `education technology`
   * must not be converted into `educationtechnology`.
   *
   * @param input Collection request input.
   * @returns Unique single-token DEV.to search tags.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    return this.buildRelevanceTerms(input)
      .filter((term) => term.length >= 3)
      .filter((term) => !term.includes(' '))
      .slice(0, 6);
  }

  /**
   * Builds the complete normalized relevance-term collection.
   *
   * User keywords are included explicitly because they represent the
   * user's requested search focus and may not exist among the configured
   * domain keywords.
   *
   * @param input Collection request input.
   * @returns Unique normalized relevance terms.
   */
  private buildRelevanceTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input)
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ]).filter(Boolean);
  }

  /**
   * Validates whether an article contains enough usable information.
   *
   * An article must provide:
   * - A valid identifier.
   * - A non-empty title.
   * - A public URL.
   * - Sufficient title and description content.
   * - No configured blocked-word occurrence.
   *
   * @param article DEV.to article.
   * @returns True when the article is valid for relevance evaluation.
   */
  private isValidArticle(article: DevToArticle): boolean {
    const title = this.cleanPlainText(article.title);

    const description = this.cleanPlainText(article.description);

    const content = this.cleanNormalizedText(`${title} ${description}`);

    if (!article.id || !title || !article.url || content.length < 40) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates the article relevance score.
   *
   * Relevance is evaluated using:
   * - Article title.
   * - Article description.
   * - DEV.to source tags.
   * - Domain keywords.
   * - User-provided keywords.
   * - Problem-related vocabulary.
   * - Reactions, comments, and publication date.
   *
   * An exact source-tag match receives an additional bonus because the
   * DEV.to platform itself classified the article under that tag.
   *
   * @param article DEV.to article.
   * @param input Collection request input.
   * @returns Calculated article relevance score.
   */
  private calculateArticleRelevanceScore(
    article: DevToArticle,
    input: CollectorInput,
  ): number {
    const articleTags = this.extractArticleTags(article);

    const relevanceTerms = this.buildRelevanceTerms(input);

    const baseScore = RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(article.title),

      body: [this.cleanPlainText(article.description), ...articleTags]
        .filter(Boolean)
        .join(' '),

      domainTerms: relevanceTerms,

      problemTerms: this.getProblemWords(),

      likes: article.positive_reactions_count ?? 0,

      replies: article.comments_count ?? 0,

      publishedAt: this.parseOptionalDate(article.published_at),
    });

    const hasExactTagMatch = articleTags.some((tag) =>
      relevanceTerms.includes(tag),
    );

    return baseScore + (hasExactTagMatch ? this.exactTagMatchBonus : 0);
  }

  /**
   * Maps a DEV.to article into the normalized CollectorPost contract.
   *
   * Source tags are retained in the transient collector result so the
   * centralized data-collection filter can use the same relevance evidence.
   *
   * @param article DEV.to article.
   * @param input Collection request input.
   * @returns Normalized collector post.
   */
  private async mapArticleToCollectorPost(
    article: DevToArticle,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectArticleComments(article);

    const title = this.cleanPlainText(article.title);

    return {
      externalId: article.id?.toString() ?? '',

      title,

      content: this.cleanPlainText(article.description) || title,

      author: article.user?.username ?? article.user?.name,

      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      /*
       * This value currently represents the requested collection language.
       * It is not automatic content-language detection.
       */
      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: article.positive_reactions_count ?? 0,

      repliesCount: article.comments_count ?? comments.length,

      publishedAt: this.parseOptionalDate(article.published_at),

      tags: this.extractArticleTags(article),

      comments,
    };
  }

  /**
   * Extracts normalized source tags returned by the DEV.to API.
   *
   * The API may return:
   * - `tag_list` as a string array.
   * - `tag_list` as a comma-separated string.
   * - `tags` as a fallback comma-separated string.
   *
   * @param article DEV.to article.
   * @returns Unique normalized article tags.
   */
  private extractArticleTags(article: DevToArticle): string[] {
    if (Array.isArray(article.tag_list)) {
      return this.unique(
        article.tag_list
          .map((tag) => this.cleanNormalizedText(tag))
          .filter(Boolean),
      );
    }

    const rawTags =
      typeof article.tag_list === 'string' ? article.tag_list : article.tags;

    if (!rawTags) {
      return [];
    }

    return this.unique(
      rawTags
        .split(',')
        .map((tag) => this.cleanNormalizedText(tag))
        .filter(Boolean),
    );
  }

  /**
   * Collects public comments associated with one DEV.to article.
   *
   * Comment failure does not fail the complete article collection.
   * Instead, the failure is logged and the article is returned without
   * comments.
   *
   * @param article DEV.to article.
   * @returns Normalized useful comments.
   */
  private async collectArticleComments(
    article: DevToArticle,
  ): Promise<CollectorComment[]> {
    if (!article.id || !article.comments_count) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'comments', [
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

          timeout: 10_000,
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
        .map((comment): CollectorComment => {
          const externalId = comment.id_code ?? comment.id?.toString() ?? '';

          return {
            externalId,

            content: this.cleanPlainText(
              comment.body_html ?? comment.body_markdown,
            ),

            author: comment.user?.username ?? comment.user?.name,

            likesCount: 0,

            publishedAt: this.parseOptionalDate(comment.created_at),
          };
        });
    } catch (error: unknown) {
      this.logger.warn(
        `DEV.to comments collection failed for article ${article.id}.`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Determines whether a DEV.to comment contains meaningful content.
   *
   * A useful comment must:
   * - Have a valid external identifier.
   * - Contain enough normalized text.
   * - Not contain configured blocked words.
   *
   * @param comment DEV.to comment.
   * @returns True when the comment is suitable for collection.
   */
  private isUsefulComment(comment: DevToComment): boolean {
    const content = this.cleanNormalizedText(
      comment.body_html ?? comment.body_markdown,
    );

    if ((!comment.id_code && !comment.id) || content.length < 40) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Converts an optional date string into a valid Date value.
   *
   * Invalid or missing values are returned as undefined to avoid
   * persisting invalid date objects.
   *
   * @param value Optional external date string.
   * @returns Parsed date or undefined.
   */
  private parseOptionalDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsedDate = new Date(value);

    return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
  }

  /**
   * Reads DEV.to-specific blocked words from configuration.
   *
   * @returns Configured blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('DEV_TO_BLOCKED_WORDS');
  }

  /**
   * Builds standard JSON headers for DEV.to requests.
   *
   * @returns HTTP request headers.
   */
  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
  }

  /**
   * Converts an unknown caught value into a safe log message.
   *
   * @param error Unknown caught value.
   * @returns Safe error message.
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
