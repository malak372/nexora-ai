import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import appStore from 'app-store-scraper';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
import { SocialCollector } from '../base/collector.interface';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorRegionUtil } from '../base/collector-region.util';

import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Represents an App Store application returned by
 * app-store-scraper.
 */
type AppStoreApp = {
  id?: string | number;
  appId?: string | number;
  title?: string;
  description?: string;
  summary?: string;
  developer?: string;
  url?: string;
  reviews?: number;
  ratings?: number;
  released?: string | Date;
};

/**
 * Represents an App Store review returned by
 * app-store-scraper.
 */
type AppStoreReview = {
  id?: string | number;
  text?: string;
  userName?: string;
  score?: number;
  updated?: string | Date;
  date?: string | Date;
};

/**
 * App Store search options used by the collector.
 */
type AppStoreSearchOptions = {
  term: string;
  country: string;
  num: number;
};

/**
 * App Store reviews options used by the collector.
 */
type AppStoreReviewsOptions = {
  id: string | number;
  country: string;
};

/**
 * Minimal typed contract required from app-store-scraper.
 */
type AppStoreClient = {
  search(options: AppStoreSearchOptions): Promise<AppStoreApp[]>;

  reviews(options: AppStoreReviewsOptions): Promise<AppStoreReview[]>;
};

/**
 * Strictly typed App Store scraper client.
 */
const appStoreClient = appStore as unknown as AppStoreClient;

/**
 * Apple App Store collector.
 *
 * Collects public applications and public reviews using
 * app-store-scraper.
 *
 * The sourceKey must match DataSource.key in the database.
 *
 * @author Malak
 */
@Injectable()
export class AppStoreCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Stable collector registry key.
   *
   * Must match:
   * DataSource.key = "app-store"
   */
  readonly sourceKey = 'app-store';

  constructor(configService: ConfigService) {
    super(configService, AppStoreCollector.name);
  }

  /**
   * Collects relevant App Store applications and reviews.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'App Store collection skipped because no search keywords exist.',
        );

        return [];
      }

      const apps = await this.searchApps(searchQuery, input);

      const rankedApps = apps
        .filter((app) => this.isValidApp(app))
        .map((app) => ({
          app,
          score: this.calculateAppRelevanceScore(app, input),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedApps.map((item) => this.mapAppToCollectorPost(item.app, input)),
      );

      this.logger.log(`App Store collection completed. Apps: ${posts.length}`);

      return posts;
    } catch (error: unknown) {
      this.logger.warn(
        'App Store collection failed',
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Searches the App Store through a cached external call.
   */
  private async searchApps(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<AppStoreApp[]> {
    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'search', [
      searchQuery,
      input.country,
      input.language,
    ]);

    return CollectorExternalCacheUtil.remember<AppStoreApp[]>(
      cacheKey,
      this.cacheTtlMs,
      () =>
        appStoreClient.search({
          term: searchQuery,
          country: this.resolveCountry(input.country),
          num: this.maxFetchedPosts,
        }),
    );
  }

  /**
   * Builds the primary App Store search query.
   *
   * Priority:
   * 1. First user keyword.
   * 2. Domain name.
   * 3. First domain keyword.
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
   * Validates an application before ranking.
   */
  private isValidApp(app: AppStoreApp): boolean {
    const appId = this.getAppId(app);

    const title = this.cleanPlainText(app.title);

    const description = this.cleanPlainText(app.description ?? app.summary);

    if (!appId || !title) {
      return false;
    }

    const content = this.cleanNormalizedText(`${title} ${description}`);

    const blockedWords = this.getAppStoreBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates application relevance.
   */
  private calculateAppRelevanceScore(
    app: AppStoreApp,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(app.title),

      body: this.cleanPlainText(app.description ?? app.summary),

      domainTerms: this.getDomainKeywords(input),

      problemTerms: this.getProblemWords(),

      likes: app.reviews ?? app.ratings ?? 0,

      replies: app.reviews ?? app.ratings ?? 0,

      publishedAt: this.parseDate(app.released),
    });
  }

  /**
   * Maps one App Store application to CollectorPost.
   */
  private async mapAppToCollectorPost(
    app: AppStoreApp,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const appId = this.getAppId(app);

    const title = this.cleanPlainText(app.title);

    const description = this.cleanPlainText(app.description ?? app.summary);

    const comments = await this.collectAppReviews(appId, input);

    return {
      externalId: String(appId),

      title,
      content: description || title,

      author: this.cleanPlainText(app.developer),

      url: app.url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: app.reviews ?? app.ratings ?? 0,

      repliesCount: comments.length,

      publishedAt: this.parseDate(app.released),

      comments,
    };
  }

  /**
   * Collects useful public reviews.
   */
  private async collectAppReviews(
    appId: string | number,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!appId) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'reviews', [
        appId,
        input.country,
        input.language,
      ]);

      const reviews = await CollectorExternalCacheUtil.remember<
        AppStoreReview[]
      >(cacheKey, this.cacheTtlMs, () =>
        appStoreClient.reviews({
          id: appId,
          country: this.resolveCountry(input.country),
        }),
      );

      return reviews
        .filter((review) => this.isUsefulReview(review, input.language))
        .slice(0, this.maxSavedComments)
        .map(
          (review): CollectorComment => ({
            externalId: this.buildReviewExternalId(appId, review),

            content: this.cleanPlainText(review.text),

            author: this.cleanPlainText(review.userName),

            languageCode: this.resolveStoredLanguageCode(input.language),

            likesCount: review.score ?? 0,

            publishedAt: this.resolveReviewDate(review),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to collect reviews for app ${String(appId)}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Builds a stable review external ID.
   */
  private buildReviewExternalId(
    appId: string | number,
    review: AppStoreReview,
  ): string {
    if (review.id !== undefined) {
      return String(review.id);
    }

    const reviewDate = this.resolveReviewDate(review);

    const datePart = reviewDate ? reviewDate.toISOString() : 'unknown-date';

    const contentPart = this.cleanNormalizedText(review.text).slice(0, 50);

    return `${String(appId)}-${datePart}-${contentPart}`;
  }

  /**
   * Resolves the review publication date.
   */
  private resolveReviewDate(review: AppStoreReview): Date | undefined {
    return this.parseDate(review.updated ?? review.date);
  }

  /**
   * Filters short, low-value, blocked, or
   * language-mismatched reviews.
   */
  private isUsefulReview(review: AppStoreReview, language?: string): boolean {
    const rawContent = this.cleanPlainText(review.text);

    const content = this.cleanNormalizedText(rawContent);

    if (content.length < 40) {
      return false;
    }

    if (!CollectorLanguageUtil.matchesRequestedLanguage(rawContent, language)) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    const lowValueReviews = new Set([
      'excellent',
      'good',
      'nice',
      'thanks',
      'thank you',
      'awesome',
      'great',
      'love it',
      'very good',
      'very nice',
      'great app',
      'good app',
      'nice app',
    ]);

    if (lowValueReviews.has(content)) {
      return false;
    }

    const blockedWords = this.getAppStoreBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Returns the best available application ID.
   */
  private getAppId(app: AppStoreApp): string | number {
    return app.id ?? app.appId ?? '';
  }

  /**
   * Resolves the App Store storefront country.
   *
   * Palestine and unresolved values fall back to US.
   */
  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    if (!regionCode || regionCode === 'PS') {
      return 'us';
    }

    return regionCode.toLowerCase();
  }

  /**
   * Parses an external date safely.
   */
  private parseDate(value?: string | Date): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Reads App Store-specific blocked words.
   */
  private getAppStoreBlockedWords(): string[] {
    return super.getBlockedWords('APP_STORE_BLOCKED_WORDS');
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
