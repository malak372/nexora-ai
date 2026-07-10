import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
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
 * the app-store-scraper library.
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
 * the app-store-scraper library.
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
 * Options supported by the App Store search operation.
 */
type AppStoreSearchOptions = {
  term: string;
  country: string;
  num: number;
};

/**
 * Options supported by the App Store reviews operation.
 */
type AppStoreReviewsOptions = {
  id: string | number;
  country: string;
};

/**
 * Minimal typed contract required from app-store-scraper.
 *
 * The package does not always expose sufficiently strict
 * TypeScript definitions, so this local contract prevents
 * unsafe calls and member access.
 */
type AppStoreClient = {
  search(options: AppStoreSearchOptions): Promise<AppStoreApp[]>;

  reviews(options: AppStoreReviewsOptions): Promise<AppStoreReview[]>;
};

/**
 * Typed App Store scraper client.
 *
 * The runtime object is provided by app-store-scraper,
 * while the local interface supplies the strict TypeScript
 * contract needed by the collector.
 */
const appStoreClient = appStore as unknown as AppStoreClient;

/**
 * Apple App Store collector.
 *
 * Collects public App Store applications and public user reviews
 * using app-store-scraper.
 *
 * Notes:
 * - External app-store-scraper calls are cached through
 *   CollectorExternalCacheUtil.
 * - App Store search requires a supported storefront country code.
 * - If a country is not supported or not provided, US is used
 *   as the fallback storefront.
 *
 * @author Malak
 */
@Injectable()
export class AppStoreCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Platform source type stored with collected records.
   */
  readonly sourceType = CollectionSourceType.APP_STORE;

  /**
   * Human-readable platform name.
   */
  private readonly platformName = 'App Store';

  constructor(configService: ConfigService) {
    super(configService, AppStoreCollector.name);
  }

  /**
   * Collects relevant App Store applications and their reviews.
   *
   * @param input Collection job configuration.
   * @returns Unified collector posts.
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
        error instanceof Error ? error.message : String(error),
      );

      return [];
    }
  }

  /**
   * Searches the App Store using a cached external call.
   *
   * @param searchQuery Search phrase.
   * @param input Collection job configuration.
   * @returns Matching App Store applications.
   */
  private async searchApps(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<AppStoreApp[]> {
    const cacheKey = CollectorCacheUtil.build('app-store', 'search', [
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
   * Determines whether an App Store application contains
   * the minimum required data and is not blocked.
   *
   * @param app App Store application.
   * @returns True when the application is valid.
   */
  private isValidApp(app: AppStoreApp): boolean {
    const appId = this.getAppId(app);
    const title = this.normalizeText(app.title ?? '');
    const description = this.normalizeText(
      app.description ?? app.summary ?? '',
    );

    if (!appId || !title) {
      return false;
    }

    const blockedWords = this.getAppStoreBlockedWords();

    const content = `${title} ${description}`;

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Calculates the application's relevance score.
   *
   * @param app App Store application.
   * @param input Collection job configuration.
   * @returns Relevance score.
   */
  private calculateAppRelevanceScore(
    app: AppStoreApp,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: app.title ?? '',
      body: app.description ?? app.summary ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: app.reviews ?? app.ratings ?? 0,
      replies: app.reviews ?? app.ratings ?? 0,
      publishedAt: app.released ? new Date(app.released) : undefined,
    });
  }

  /**
   * Maps one App Store application into the unified
   * collector post structure.
   *
   * @param app App Store application.
   * @param input Collection job configuration.
   * @returns Unified collector post.
   */
  private async mapAppToCollectorPost(
    app: AppStoreApp,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const appId = this.getAppId(app);

    const comments = await this.collectAppReviews(appId, input);

    return {
      sourceType: CollectionSourceType.APP_STORE,
      platformName: this.platformName,
      externalId: String(appId),
      title: app.title,
      content: app.description ?? app.summary ?? app.title ?? '',
      author: app.developer,
      url: app.url,
      country: input.country,
      city: input.city,
      region: input.region,
      language: input.language,
      likesCount: app.reviews ?? app.ratings ?? 0,
      repliesCount: comments.length,
      publishedAt: app.released ? new Date(app.released) : undefined,
      comments,
    };
  }

  /**
   * Collects and maps useful public reviews for one application.
   *
   * @param appId App Store application identifier.
   * @param input Collection job configuration.
   * @returns Unified collector comments.
   */
  private async collectAppReviews(
    appId: string | number,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    try {
      const cacheKey = CollectorCacheUtil.build('app-store', 'reviews', [
        appId,
        input.country,
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
            content: review.text ?? '',
            author: review.userName,
            language: input.language,
            likesCount: review.score ?? 0,
            publishedAt: this.resolveReviewDate(review),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to collect reviews for app ${String(appId)}`,
        error instanceof Error ? error.message : String(error),
      );

      return [];
    }
  }

  /**
   * Builds a stable external identifier for an App Store review.
   *
   * The review ID is preferred. When it is unavailable,
   * the application ID and normalized review date are used.
   *
   * @param appId App Store application identifier.
   * @param review App Store review.
   * @returns Stable review identifier.
   */
  private buildReviewExternalId(
    appId: string | number,
    review: AppStoreReview,
  ): string {
    if (review.id !== undefined) {
      return String(review.id);
    }

    const reviewDate = review.updated ?? review.date;

    const datePart = reviewDate
      ? new Date(reviewDate).toISOString()
      : 'unknown-date';

    return `${String(appId)}-${datePart}`;
  }

  /**
   * Resolves the publication date of an App Store review.
   *
   * The updated date is preferred over the original date.
   *
   * @param review App Store review.
   * @returns Parsed review date when available.
   */
  private resolveReviewDate(review: AppStoreReview): Date | undefined {
    const dateValue = review.updated ?? review.date;

    return dateValue ? new Date(dateValue) : undefined;
  }

  /**
   * Determines whether a review contains useful content
   * for later NLP analysis.
   *
   * @param review App Store review.
   * @param language Requested collection language.
   * @returns True when the review should be retained.
   */
  private isUsefulReview(review: AppStoreReview, language?: string): boolean {
    const rawContent = review.text ?? '';
    const content = this.normalizeText(rawContent);

    if (!review.id || content.length < 40) {
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

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Returns the best available application identifier.
   *
   * @param app App Store application.
   * @returns Application identifier or an empty string.
   */
  private getAppId(app: AppStoreApp): string | number {
    return app.id ?? app.appId ?? '';
  }

  /**
   * Resolves the App Store storefront country code.
   *
   * Palestine and unresolved regions currently fall back
   * to the United States storefront.
   *
   * @param country Requested country.
   * @returns Lowercase App Store country code.
   */
  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    if (!regionCode || regionCode === 'PS') {
      return 'us';
    }

    return regionCode.toLowerCase();
  }

  /**
   * Returns App Store-specific blocked words.
   *
   * @returns Normalized blocked words.
   */
  private getAppStoreBlockedWords(): string[] {
    return super.getBlockedWords('APP_STORE_BLOCKED_WORDS');
  }
}
