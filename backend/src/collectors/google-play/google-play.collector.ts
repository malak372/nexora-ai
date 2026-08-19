import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import gplay from 'google-play-scraper';

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

type GooglePlayApp = {
  appId?: string;
  title?: string;
  summary?: string;
  developer?: string;
  url?: string;
  ratings?: number;
};

type GooglePlayReview = {
  id?: string;
  text?: string;
  userName?: string;
  thumbsUp?: number;
  score?: number;
  date?: string | Date;
};

type GooglePlayReviewsResponse = {
  data?: GooglePlayReview[];
};

type GooglePlaySearchOptions = {
  term: string;
  num: number;
  lang: string;
  country: string;
};

type GooglePlayReviewsOptions = {
  appId: string;
  num: number;
  sort: string | number;
  lang: string;
  country: string;
};

type GooglePlayClient = {
  search(options: GooglePlaySearchOptions): Promise<GooglePlayApp[]>;

  reviews(
    options: GooglePlayReviewsOptions,
  ): Promise<GooglePlayReviewsResponse>;

  sort?: {
    NEWEST?: string | number;
  };
};

const googlePlayClient = gplay as unknown as GooglePlayClient;

/**
 * Google Play collector.
 *
 * Collects public Google Play applications and reviews.
 *
 * @author Malak
 */
@Injectable()
export class GooglePlayCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'google-play';

  constructor(configService: ConfigService) {
    super(configService, GooglePlayCollector.name);
  }

  /**
   * Collects, ranks, and maps Google Play applications.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQueries = this.buildSearchQueries(input);

      if (searchQueries.length === 0) {
        this.logger.warn(
          'Google Play collection skipped because no search keywords exist.',
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
        .filter((app) => this.isValidApp(app, input))
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

      const posts = await Promise.all(
        rankedApps.map((item) => this.mapAppToCollectorPost(item.app, input)),
      );

      this.logger.log(
        `Google Play collection completed. Apps: ${posts.length} | mode=${input.collectionMode ?? 'STANDARD'} | parallel=true`,
      );

      return posts;
    } catch (error: unknown) {
      this.logger.warn(
        'Google Play collection failed',
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Searches Google Play applications.
   */
  private async searchApps(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<GooglePlayApp[]> {
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

    const requestedResults = await CollectorExternalCacheUtil.remember<
      GooglePlayApp[]
    >(cacheKey, this.cacheTtlMs, () =>
      googlePlayClient.search({
        term: searchQuery,
        num: Math.min(this.resolveMaxFetchedPosts(input), 20),
        lang: this.resolveLanguage(input.language),
        country: requestedCountry,
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
      `Google Play returned no apps for country "${requestedCountry}"; retrying discovery with the global US catalogue while preserving the requested location as metadata.`,
    );

    return CollectorExternalCacheUtil.remember<GooglePlayApp[]>(
      fallbackCacheKey,
      this.cacheTtlMs,
      () =>
        googlePlayClient.search({
          term: searchQuery,
          num: Math.min(this.resolveMaxFetchedPosts(input), 20),
          lang: this.resolveLanguage(input.language),
          country: 'us',
        }),
    );
  }

  /**
   * Builds several focused Google Play search queries.
   *
   * Searching one long phrase frequently returns no results because store
   * search treats all terms as a narrow product query. Focused queries improve
   * recall while relevance scoring still protects the saved dataset.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const plannedQueries = (input.plannedQueries ?? [])
      .map((query) => this.toStoreDiscoveryQuery(query))
      .filter(Boolean);
    const isBoundedMode =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';

    if (plannedQueries.length > 0 && isBoundedMode) {
      return this.unique(plannedQueries).slice(0, 3);
    }

    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const terms = this.unique(
      input.collectionMode === 'TARGETED_RECOVERY'
        ? [...domainKeywords, ...fallbackDomain, ...userKeywords]
        : [...userKeywords, ...domainKeywords, ...fallbackDomain],
    )
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);

    const focusedQueries = terms.slice(0, isBoundedMode ? 3 : 4);

    // FAST_GENERATION keeps one standalone query per selected-domain anchor.
    // A combined "AI Finance Food" query weakens store relevance and makes
    // secondary domains disappear even though their keywords were balanced.
    if (isBoundedMode) {
      return this.unique(focusedQueries).slice(0, 3);
    }

    const combinedQuery = terms.slice(0, 3).join(' ');
    return this.unique([
      ...focusedQueries,
      ...(combinedQuery ? [combinedQuery] : []),
    ]).slice(0, 5);
  }

  private toStoreDiscoveryQuery(value: string): string {
    const stopWords = new Set([
      'conflict', 'conflicts', 'missing', 'forgotten', 'fragmented', 'problem',
      'problems', 'complaint', 'complaints', 'review', 'reviews', 'difficult',
      'coordination', 'tracking', 'records', 'record',
    ]);
    return this.cleanNormalizedText(value)
      .split(/\s+/u)
      .filter(Boolean)
      .filter((word) => !stopWords.has(word))
      .slice(0, 4)
      .join(' ');
  }

  /** Removes duplicate applications returned by multiple focused searches. */
  private deduplicateApps(apps: readonly GooglePlayApp[]): GooglePlayApp[] {
    const uniqueApps = new Map<string, GooglePlayApp>();

    for (const app of apps) {
      const appId = app.appId?.trim();

      if (appId && !uniqueApps.has(appId)) {
        uniqueApps.set(appId, app);
      }
    }

    return [...uniqueApps.values()];
  }

  /**
   * Validates a Google Play application.
   */
  private isValidApp(app: GooglePlayApp, input: CollectorInput): boolean {
    const title = this.cleanPlainText(app.title);
    const summary = this.cleanPlainText(app.summary);

    if (!app.appId || !title) {
      return false;
    }

    const content = this.cleanNormalizedText(`${title} ${summary}`);

    if (!this.isGamingDomain(input) && this.isLikelyGameContent(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
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
  private isLikelyGameContent(value: string): boolean {
    const content = this.cleanNormalizedText(value);
    const patterns = [
      /\b(?:farming|farm|tractor|village)\s+(?:simulator|simulation|game)\b/iu,
      /\b(?:simulator|simulation)\s+(?:3d|game)\b/iu,
      /\b(?:video\s+game|mobile\s+game|gameplay|gamer|multiplayer|save\s+games?|restart\s+game|walking\s+controls?|loader\s+controls?|levels?|quests?|characters?|bug\s+village|farm\s+valley|tractor\s+driving)\b/iu,
      /\b(?:play|played|playing)\s+(?:this|the)\s+game\b/iu,
    ];

    return patterns.some((pattern) => pattern.test(content));
  }

  /**
   * Calculates application relevance.
   */
  private calculateAppRelevanceScore(
    app: GooglePlayApp,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(app.title),
      body: this.cleanPlainText(app.summary),
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: app.ratings ?? 0,
      replies: app.ratings ?? 0,
    });
  }

  /**
   * Maps a Google Play application.
   */
  private async mapAppToCollectorPost(
    app: GooglePlayApp,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const appId = app.appId ?? '';
    const title = this.cleanPlainText(app.title);
    const summary = this.cleanPlainText(app.summary);

    const comments = await this.collectAppReviews(appId, input);

    return {
      externalId: appId,
      title,
      content: summary || title,
      author: this.cleanPlainText(app.developer),
      url: app.url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: app.ratings ?? 0,
      repliesCount: comments.length,

      comments,
    };
  }

  /**
   * Collects useful public reviews.
   */
  private async collectAppReviews(
    appId: string,
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

      const response =
        await CollectorExternalCacheUtil.remember<GooglePlayReviewsResponse>(
          cacheKey,
          this.cacheTtlMs,
          () =>
            googlePlayClient.reviews({
              appId,
              num:
                input.collectionMode === 'FAST_GENERATION' ||
                input.collectionMode === 'TARGETED_RECOVERY'
                  ? Math.min(this.resolveMaxFetchedComments(input), 4)
                  : this.resolveMaxFetchedComments(input),
              sort: this.getNewestSort(),
              lang: this.resolveLanguage(input.language),
              country: this.resolveCountry(input.country),
            }),
        );

      return (response.data ?? [])
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

            likesCount: review.thumbsUp ?? 0,
            publishedAt: this.resolveReviewDate(review),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Google Play reviews collection failed for app ${appId}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Builds a stable review external ID.
   */
  private buildReviewExternalId(
    appId: string,
    review: GooglePlayReview,
  ): string {
    if (review.id) {
      return review.id;
    }

    const datePart =
      this.resolveReviewDate(review)?.toISOString() ?? 'unknown-date';

    const textPart = this.cleanNormalizedText(review.text).slice(0, 50);

    return `${appId}-${datePart}-${textPart}`;
  }

  /**
   * Resolves a review date safely.
   */
  private resolveReviewDate(review: GooglePlayReview): Date | undefined {
    if (!review.date) {
      return undefined;
    }

    const date = new Date(review.date);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Filters low-value reviews.
   */
  private isUsefulReview(
    review: GooglePlayReview,
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

    if (!this.isGamingDomain(input) && this.isLikelyGameContent(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

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
  private reviewProblemPriority(review: GooglePlayReview): number {
    const content = this.cleanNormalizedText(
      this.cleanPlainText(review.text),
    );
    const score = Number(review.score);
    const lowRatingBonus =
      Number.isFinite(score) && score > 0 && score <= 3 ? 3 : 0;
    const complaintBonus = this.hasReviewProblemSignal(content) ? 5 : 0;

    return complaintBonus + lowRatingBonus + Math.min(review.thumbsUp ?? 0, 5) / 10;
  }

  /**
   * Reads Google Play blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GOOGLE_PLAY_BLOCKED_WORDS');
  }

  /**
   * Resolves the Google Play language code.
   */
  private resolveLanguage(language?: string): string {
    return CollectorLanguageUtil.resolveLanguageCode(language) ?? 'en';
  }

  /**
   * Resolves the Google Play country code.
   */
  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    return regionCode?.toLowerCase() ?? 'us';
  }

  /**
   * Returns the newest-review sort value.
   */
  private getNewestSort(): string | number {
    return googlePlayClient.sort?.NEWEST ?? 'NEWEST';
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
      : 'Unknown Google Play collector error.';
  }
}