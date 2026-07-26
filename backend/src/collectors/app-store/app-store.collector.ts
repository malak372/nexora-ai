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
      const searchQueries = this.buildSearchQueries(input);

      if (searchQueries.length === 0) {
        this.logger.warn(
          'App Store collection skipped because no search keywords exist.',
        );

        return [];
      }

      const searchResults = await Promise.all(
        searchQueries.map((query) => this.searchApps(query, input)),
      );
      const apps = this.deduplicateApps(searchResults.flat());

      const rankedApps = apps
        .filter((app) => this.isValidApp(app))
        .filter((app) => this.isRelevantApp(app, input))
        .map((app) => ({
          app,
          score: this.calculateAppRelevanceScore(app, input),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const posts: CollectorPost[] = [];

      // Review endpoints are more sensitive to bursts than search endpoints.
      // Collect sequentially so one throttled request does not cause all apps
      // to lose their review evidence at the same time.
      for (const item of rankedApps) {
        posts.push(await this.mapAppToCollectorPost(item.app, input));
        await this.delay(250);
      }

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

    const requestedCountry = this.resolveCountry(input.country);
    const requestedResults = await CollectorExternalCacheUtil.remember<
      AppStoreApp[]
    >(cacheKey, this.cacheTtlMs, () =>
      appStoreClient.search({
        term: searchQuery,
        country: requestedCountry,
        num: Math.min(this.maxFetchedPosts, 25),
      }),
    );

    if (requestedResults.length > 0 || requestedCountry === 'us') {
      return requestedResults;
    }

    const fallbackCacheKey = CollectorCacheUtil.build(
      this.sourceKey,
      'search-fallback',
      [searchQuery, 'us', input.language],
    );

    this.logger.warn(
      `App Store returned no apps for country "${requestedCountry}"; retrying discovery with the US catalogue.`,
    );

    return CollectorExternalCacheUtil.remember<AppStoreApp[]>(
      fallbackCacheKey,
      this.cacheTtlMs,
      () =>
        appStoreClient.search({
          term: searchQuery,
          country: 'us',
          num: Math.min(this.maxFetchedPosts, 25),
        }),
    );
  }

  /** Builds focused queries instead of relying on one broad domain term. */
  private buildSearchQueries(input: CollectorInput): string[] {
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);
    const domainKeywords = this.getDomainKeywords(input)
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);
    const domainName = this.cleanNormalizedText(input.domainName);
    const terms = this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...(domainName ? [domainName] : []),
    ])
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 8);

    const focused = terms.slice(0, 5);
    const intentQueries = [
      terms.find((term) =>
        /irrigat|schedule|controller|offline|farm management/iu.test(term),
      ),
      terms.slice(0, 2).join(' '),
    ].filter((term): term is string => Boolean(term));

    return this.unique([...intentQueries, ...focused]).slice(0, 6);
  }

  /** Deduplicates applications returned by multiple focused searches. */
  private deduplicateApps(apps: readonly AppStoreApp[]): AppStoreApp[] {
    const uniqueApps = new Map<string, AppStoreApp>();

    for (const app of apps) {
      const appId = this.getAppId(app);

      if (appId && !uniqueApps.has(String(appId))) {
        uniqueApps.set(String(appId), app);
      }
    }

    return [...uniqueApps.values()];
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
   * Requires a direct domain or user-keyword match and rejects entertainment
   * apps that appear because they use broad words such as farming or driving.
   */
  private isRelevantApp(app: AppStoreApp, input: CollectorInput): boolean {
    const title = this.cleanNormalizedText(app.title);
    const description = this.cleanNormalizedText(
      app.description ?? app.summary,
    );
    const searchableText = `${title} ${description}`;

    if (
      !this.isGamingDomain(input) &&
      this.isLikelyEntertainmentContent(searchableText)
    ) {
      return false;
    }

    const directTerms = this.unique([
      ...(input.keywords ?? []),
      ...this.getDomainKeywords(input),
      input.domainName ?? '',
    ])
      .map((term) => this.cleanNormalizedText(term))
      .filter((term) => term.length >= 3);

    return directTerms.some((term) => searchableText.includes(term));
  }

  /** Detects whether the requested domain intentionally targets games. */
  private isGamingDomain(input: CollectorInput): boolean {
    const domainText = this.cleanNormalizedText(
      `${input.domainName ?? ''} ${(input.keywords ?? []).join(' ')}`,
    );

    return /\b(?:gaming|game development|video games?|mobile games?)\b/iu.test(
      domainText,
    );
  }

  /** Rejects gameplay products and reviews from non-gaming domains. */
  private isLikelyEntertainmentContent(value: string): boolean {
    const content = this.cleanNormalizedText(value);
    const patterns = [
      /\b(?:farming|farm|tractor|village)\s+(?:simulator|simulation|game)\b/iu,
      /\b(?:simulator|simulation)\s+(?:3d|game)\b/iu,
      /\b(?:video\s+game|mobile\s+game|gameplay|multiplayer|save\s+games?|restart\s+game|walking\s+controls?|loader\s+controls?|levels?|quests?|characters?|bug\s+village|farm\s+valley|tractor\s+driving)\b/iu,
      /\b(?:play|played|playing)\s+(?:this|the)\s+game\b/iu,
    ];

    return patterns.some((pattern) => pattern.test(content));
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

      const requestedCountry = this.resolveCountry(input.country);
      let reviews: AppStoreReview[];

      try {
        reviews = await CollectorExternalCacheUtil.remember<AppStoreReview[]>(
          cacheKey,
          this.cacheTtlMs,
          () =>
            appStoreClient.reviews({
              id: appId,
              country: requestedCountry,
            }),
        );
      } catch (error: unknown) {
        if (requestedCountry === 'us') {
          throw error;
        }

        const fallbackCacheKey = CollectorCacheUtil.build(
          this.sourceKey,
          'reviews-fallback',
          [appId, 'us', input.language],
        );

        this.logger.warn(
          `App Store reviews failed for country "${requestedCountry}" and app ${String(
            appId,
          )}; retrying with the US storefront.`,
        );

        reviews = await CollectorExternalCacheUtil.remember<AppStoreReview[]>(
          fallbackCacheKey,
          this.cacheTtlMs,
          () => appStoreClient.reviews({ id: appId, country: 'us' }),
        );
      }

      return reviews
        .filter((review) => this.isUsefulReview(review, input))
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
  private isUsefulReview(
    review: AppStoreReview,
    input: CollectorInput,
  ): boolean {
    const rawContent = this.cleanPlainText(review.text);

    const content = this.cleanNormalizedText(rawContent);

    if (content.length < 40) {
      return false;
    }

    if (
      !CollectorLanguageUtil.matchesRequestedLanguage(
        rawContent,
        input.language,
      )
    ) {
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

    if (
      !this.isGamingDomain(input) &&
      this.isLikelyEntertainmentContent(content)
    ) {
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

  /** Adds a small delay between review requests. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
