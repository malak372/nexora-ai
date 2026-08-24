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

      const searchResults = await Promise.allSettled(
        searchQueries.map((query) => this.searchApps(query, input)),
      );
      const apps = this.deduplicateApps(
        searchResults.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        ),
      );

      const rankedApps = apps
        .filter((app) => this.isValidApp(app))
        .filter((app) => this.isRelevantApp(app, input))
        .map((app) => ({
          app,
          score: this.calculateAppRelevanceScore(app, input),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(
          0,
          input.collectionMode === 'FAST_GENERATION' ||
          input.collectionMode === 'TARGETED_RECOVERY'
            ? Math.min(2, this.resolveMaxSavedPosts(input))
            : this.resolveMaxSavedPosts(input),
        );

      const isBoundedParallelMode =
        input.collectionMode === 'FAST_GENERATION' ||
        input.collectionMode === 'TARGETED_RECOVERY';
      const posts: CollectorPost[] = isBoundedParallelMode
        ? (
            await Promise.allSettled(
              rankedApps.map((item) =>
                this.mapAppToCollectorPost(item.app, input),
              ),
            )
          ).flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : [],
          )
        : [];

      if (!isBoundedParallelMode) {
        // Standard mode keeps the conservative sequential review policy.
        for (const item of rankedApps) {
          posts.push(await this.mapAppToCollectorPost(item.app, input));
          await this.delay(250);
        }
      }

      this.logger.log(`App Store collection completed. Apps: ${posts.length} | mode=${input.collectionMode ?? 'STANDARD'} | parallel=${input.collectionMode === 'FAST_GENERATION'}`);

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

    const requestedCountry =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY'
        ? 'us'
        : this.resolveCountry(input.country);
    const requestedResults = await this.searchAppsWithBoundedFallback(
      cacheKey,
      searchQuery,
      requestedCountry,
      input,
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
          num: Math.min(this.resolveMaxFetchedPosts(input), 25),
        }),
    );
  }

  /**
   * Executes one cached App Store search with a single bounded direct retry.
   *
   * The direct retry bypasses a failed cache wrapper call, then a secondary
   * English storefront is attempted only when the US storefront still returns
   * no results. This keeps FAST_GENERATION bounded while avoiding an immediate
   * zero-result collector after one transient scraper/cache failure.
   */
  private async searchAppsWithBoundedFallback(
    cacheKey: string,
    searchQuery: string,
    requestedCountry: string,
    input: CollectorInput,
  ): Promise<AppStoreApp[]> {
    const num = Math.min(this.resolveMaxFetchedPosts(input), 25);
    const search = (country: string) =>
      appStoreClient.search({
        term: searchQuery,
        country,
        num,
      });

    try {
      return await CollectorExternalCacheUtil.remember<AppStoreApp[]>(
        cacheKey,
        this.cacheTtlMs,
        () => search(requestedCountry),
      );
    } catch (firstError: unknown) {
      this.logger.warn(
        `App Store cached search failed for "${searchQuery}" in ${requestedCountry}; retrying once without cache.`,
      );

      try {
        const directResults = await search(requestedCountry);
        if (directResults.length > 0) {
          return directResults;
        }
      } catch (retryError: unknown) {
        this.logger.warn(
          `App Store direct retry failed for "${searchQuery}" in ${requestedCountry}: ${this.getErrorMessage(
            retryError,
          )}`,
        );
      }

      if (
        input.collectionMode !== 'FAST_GENERATION' &&
        requestedCountry === 'us'
      ) {
        try {
          this.logger.warn(
            `App Store US search produced no usable result for "${searchQuery}"; trying the GB storefront once.`,
          );
          return await search('gb');
        } catch (fallbackError: unknown) {
          this.logger.warn(
            `App Store GB fallback failed for "${searchQuery}": ${this.getErrorMessage(
              fallbackError,
            )}`,
          );
        }
      }

      this.logger.debug(
        `App Store search exhausted bounded fallbacks for "${searchQuery}": ${this.getErrorMessage(
          firstError,
        )}`,
      );
      return [];
    }
  }

  /** Builds focused queries instead of relying on one broad domain term. */
  private buildSearchQueries(input: CollectorInput): string[] {
    const plannedQueries = (input.plannedQueries ?? [])
      .map((query) => this.toStoreDiscoveryQuery(query))
      .filter(Boolean);
    const isBoundedMode =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';

    if (plannedQueries.length > 0 && isBoundedMode) {
      const domainDiscovery = this.toStoreDiscoveryQuery(input.domainName);
      const requesterActor = this.toStoreDiscoveryQuery(
        input.requestDescription?.split(/\b(?:often|frequently|usually|commonly)\b/iu)[0] ?? '',
      );
      const boundedBudget =
        input.collectionMode === 'TARGETED_RECOVERY' ? 1 : 2;
      return this.unique([
        ...(requesterActor ? [requesterActor] : []),
        ...(domainDiscovery ? [domainDiscovery] : []),
        ...plannedQueries.slice(0, 1),
      ]).slice(0, boundedBudget);
    }

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);
    const domainKeywords = this.getDomainKeywords(input)
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);
    const domainName = this.cleanNormalizedText(input.domainName);
    const terms = this.unique(
      input.collectionMode === 'TARGETED_RECOVERY'
        ? [
            ...domainKeywords,
            ...(domainName ? [domainName] : []),
            ...userKeywords,
          ]
        : [
            ...userKeywords,
            ...domainKeywords,
            ...(domainName ? [domainName] : []),
          ],
    )
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 8);

    /*
     * In FAST_GENERATION the first balanced keywords are the selected domain
     * anchors (for example AI, Finance, Food). Keep them as independent search
     * lanes instead of joining them into one cross-domain query. That gives
     * every selected domain a real App Store discovery attempt while all lanes
     * still execute concurrently in the single collector wave.
     */
    if (isBoundedMode) {
      return this.unique(terms.slice(0, 3)).slice(0, 3);
    }

    const focused = terms.slice(0, 5);
    const intentQueries = [
      terms.find((term) =>
        /irrigat|schedule|controller|offline|farm management|computer vision|segmentation|nutrition tracking|route planning/iu.test(
          term,
        ),
      ),
      terms.slice(0, 2).join(' '),
    ].filter((term): term is string => Boolean(term));

    return this.unique([...intentQueries, ...focused]).slice(0, 6);
  }

  private toStoreDiscoveryQuery(value: string): string {
    const stopWords = new Set([
      'conflict', 'conflicts', 'missing', 'forgotten', 'fragmented', 'problem',
      'problems', 'complaint', 'complaints', 'review', 'reviews', 'difficult',
      'coordination', 'tracking', 'records', 'record', 'detecting',
      'identify', 'identifying', 'analysis', 'analyze', 'organization',
      'organizing', 'bottleneck', 'risk', 'risks', 'for', 'and', 'the', 'of', 'to',
    ]);
    return this.cleanNormalizedText(value)
      .split(/\s+/u)
      .filter(Boolean)
      .filter((word) => !stopWords.has(word))
      .slice(0, 3)
      .join(' ');
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

      const requestedCountry =
        input.collectionMode === 'FAST_GENERATION'
          ? 'us'
          : this.resolveCountry(input.country);
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
        .sort(
          (left, right) =>
            this.reviewProblemPriority(right) -
            this.reviewProblemPriority(left),
        )
        .slice(0, this.resolveMaxSavedComments(input))
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

    const hasProblemSignal = this.hasReviewProblemSignal(content);

    if (content.length < (hasProblemSignal ? 20 : 40)) {
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

  /** Returns true when a review contains a concrete complaint or request. */
  private hasReviewProblemSignal(content: string): boolean {
    return /(?:\b(?:cannot|can't|unable|doesn't work|not working|failed|failure|error|bug|crash|freeze|missing|broken|slow|lag|confusing|difficult|problem|issue|frustrating|unavailable|inaccessible|need|needs|wish|request|should add|please add|paywall|subscription|ads?|privacy)\b|(?:لا يعمل|لا أستطيع|غير متاح|مشكلة|خطأ|تعطل|بطيء|صعب|مفقود|اشتراك|إعلانات|أحتاج|نحتاج|اقتراح|طلب ميزة))/iu.test(
      content,
    );
  }

  /** Prioritizes low-rated and complaint-bearing reviews before saving. */
  private reviewProblemPriority(review: AppStoreReview): number {
    const content = this.cleanNormalizedText(
      this.cleanPlainText(review.text),
    );
    const score = Number(review.score);
    const lowRatingBonus =
      Number.isFinite(score) && score > 0 && score <= 3 ? 3 : 0;
    const complaintBonus = this.hasReviewProblemSignal(content) ? 5 : 0;

    return complaintBonus + lowRatingBonus;
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