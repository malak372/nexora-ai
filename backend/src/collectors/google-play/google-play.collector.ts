import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
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

/**
 * Represents a Google Play application returned by
 * google-play-scraper.
 */
type GooglePlayApp = {
  appId?: string;
  title?: string;
  summary?: string;
  developer?: string;
  url?: string;
  ratings?: number;
};

/**
 * Represents a public Google Play application review.
 */
type GooglePlayReview = {
  id?: string;
  text?: string;
  userName?: string;
  thumbsUp?: number;
  date?: string | Date;
};

/**
 * Represents the Google Play reviews response.
 */
type GooglePlayReviewsResponse = {
  data?: GooglePlayReview[];
};

/**
 * Options required by the Google Play search operation.
 */
type GooglePlaySearchOptions = {
  term: string;
  num: number;
  lang: string;
  country: string;
};

/**
 * Options required by the Google Play reviews operation.
 */
type GooglePlayReviewsOptions = {
  appId: string;
  num: number;
  sort: string | number;
  lang: string;
  country: string;
};

/**
 * Minimal type definition required from google-play-scraper.
 *
 * A local contract is used because the package typings may
 * expose some members as any depending on the installed version.
 */
type GooglePlayClient = {
  search(options: GooglePlaySearchOptions): Promise<GooglePlayApp[]>;

  reviews(
    options: GooglePlayReviewsOptions,
  ): Promise<GooglePlayReviewsResponse>;

  sort?: {
    NEWEST?: string | number;
  };
};

/**
 * Strictly typed google-play-scraper client.
 */
const googlePlayClient = gplay as unknown as GooglePlayClient;

/**
 * Google Play collector.
 *
 * Collects public Google Play apps and public app reviews
 * using google-play-scraper.
 *
 * @author Malak
 */
@Injectable()
export class GooglePlayCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Platform source type stored with collected records.
   */
  readonly sourceType = CollectionSourceType.GOOGLE_PLAY;

  /**
   * Human-readable platform name.
   */
  private readonly platformName = 'Google Play';

  constructor(configService: ConfigService) {
    super(configService, GooglePlayCollector.name);
  }

  /**
   * Collects Google Play apps, ranks them by relevance,
   * attaches useful public reviews, and maps them to CollectorPost.
   *
   * @param input Collection job configuration.
   * @returns Relevant Google Play applications and reviews.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Google Play collection skipped because no search keywords exist.',
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

      this.logger.log(
        `Google Play collection completed. Apps: ${posts.length}`,
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
   * Searches Google Play applications with cache support.
   *
   * @param searchQuery Search phrase.
   * @param input Collection job configuration.
   * @returns Matching Google Play applications.
   */
  private async searchApps(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<GooglePlayApp[]> {
    const cacheKey = CollectorCacheUtil.build('google-play', 'search', [
      searchQuery,
      input.country,
      input.language,
    ]);

    return CollectorExternalCacheUtil.remember<GooglePlayApp[]>(
      cacheKey,
      this.cacheTtlMs,
      () =>
        googlePlayClient.search({
          term: searchQuery,
          num: Math.min(this.maxFetchedPosts, 20),
          lang: this.resolveLanguage(input.language),
          country: this.resolveCountry(input.country),
        }),
    );
  }

  /**
   * Builds a search query from domain keywords,
   * domain name, and custom user keywords.
   *
   * @param input Collection job configuration.
   * @returns Normalized Google Play search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    return this.unique([...domainKeywords, ...fallbackDomain, ...userKeywords])
      .slice(0, 4)
      .join(' ');
  }

  /**
   * Validates a Google Play application before ranking.
   *
   * @param app Google Play application.
   * @returns True when the application contains valid content.
   */
  private isValidApp(app: GooglePlayApp): boolean {
    const title = this.cleanPlainText(app.title);

    const summary = this.cleanPlainText(app.summary);

    if (!app.appId || !title) {
      return false;
    }

    const content = this.cleanNormalizedText(`${title} ${summary}`);

    if (this.isLikelyGameApp(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Detects game-like applications that may pollute
   * domain-specific Google Play results.
   *
   * @param content Normalized application content.
   * @returns True when the application appears to be a game.
   */
  private isLikelyGameApp(content: string): boolean {
    const gameTerms = [
      'game',
      'games',
      'simulator',
      'simulation',
      'school simulator',
      'teacher simulator',
      'teacher game',
      'student game',
      'classroom play',
      'rpg',
      'mini game',
      'minigame',
      'offline game',
      'puzzle game',
    ];

    return gameTerms.some((term) => content.includes(term));
  }

  /**
   * Calculates application relevance using the
   * shared relevance scoring utility.
   *
   * @param app Google Play application.
   * @param input Collection job configuration.
   * @returns Relevance score.
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
      publishedAt: undefined,
    });
  }

  /**
   * Maps a Google Play application to the unified
   * collector post format.
   *
   * @param app Google Play application.
   * @param input Collection job configuration.
   * @returns Unified collector post.
   */
  private async mapAppToCollectorPost(
    app: GooglePlayApp,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const appId = app.appId ?? '';

    const title = this.cleanPlainText(app.title);

    const summary = this.cleanPlainText(app.summary);

    const author = this.cleanPlainText(app.developer);

    const comments = await this.collectAppReviews(appId, input);

    return {
      sourceType: CollectionSourceType.GOOGLE_PLAY,
      platformName: this.platformName,
      externalId: appId,
      title,
      content: summary || title,
      author,
      url: app.url,
      country: input.country,
      city: input.city,
      region: input.region,
      language: input.language,
      likesCount: app.ratings ?? 0,
      repliesCount: comments.length,
      publishedAt: undefined,
      comments,
    };
  }

  /**
   * Collects useful public reviews for one Google Play app.
   *
   * @param appId Google Play application identifier.
   * @param input Collection job configuration.
   * @returns Unified collector comments.
   */
  private async collectAppReviews(
    appId: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!appId) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build('google-play', 'reviews', [
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
              num: this.maxSavedComments,
              sort: this.getNewestSort(),
              lang: this.resolveLanguage(input.language),
              country: this.resolveCountry(input.country),
            }),
        );

      return (response.data ?? [])
        .filter((review) => this.isUsefulReview(review, input.language))
        .slice(0, this.maxSavedComments)
        .map(
          (review): CollectorComment => ({
            externalId: this.buildReviewExternalId(appId, review),
            content: this.cleanPlainText(review.text),
            author: this.cleanPlainText(review.userName),
            language: input.language,
            likesCount: review.thumbsUp ?? 0,
            publishedAt: this.resolveReviewDate(review),
          }),
        );
    } catch {
      return [];
    }
  }

  /**
   * Builds a stable external identifier for a review.
   *
   * The original review ID is preferred. When it is missing,
   * the application ID and normalized review date are used.
   *
   * @param appId Google Play application identifier.
   * @param review Google Play review.
   * @returns Stable external review identifier.
   */
  private buildReviewExternalId(
    appId: string,
    review: GooglePlayReview,
  ): string {
    if (review.id) {
      return review.id;
    }

    const datePart = review.date
      ? new Date(review.date).toISOString()
      : 'unknown-date';

    return `${appId}-${datePart}`;
  }

  /**
   * Resolves the publication date of a Google Play review.
   *
   * @param review Google Play review.
   * @returns Parsed date when available.
   */
  private resolveReviewDate(review: GooglePlayReview): Date | undefined {
    return review.date ? new Date(review.date) : undefined;
  }

  /**
   * Filters short, low-value, blocked, or
   * language-mismatched reviews.
   *
   * @param review Google Play review.
   * @param language Requested collection language.
   * @returns True when the review is useful.
   */
  private isUsefulReview(review: GooglePlayReview, language?: string): boolean {
    const rawContent = this.cleanPlainText(review.text);

    const content = this.cleanNormalizedText(rawContent);

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

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Reads common blocked words and
   * Google Play-specific blocked words.
   *
   * @returns Normalized blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GOOGLE_PLAY_BLOCKED_WORDS');
  }

  /**
   * Resolves the requested language to a
   * Google Play language code.
   *
   * @param language Requested language.
   * @returns Google Play language code.
   */
  private resolveLanguage(language?: string): string {
    return CollectorLanguageUtil.resolveLanguageCode(language) ?? 'en';
  }

  /**
   * Resolves the requested country to a
   * Google Play country code.
   *
   * @param country Requested country.
   * @returns Lowercase country code.
   */
  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    return regionCode?.toLowerCase() ?? 'us';
  }

  /**
   * Returns the newest review sort value.
   *
   * A string fallback is used when the installed scraper
   * version does not expose its sort constants.
   *
   * @returns Google Play newest review sort value.
   */
  private getNewestSort(): string | number {
    return googlePlayClient.sort?.NEWEST ?? 'NEWEST';
  }

  /**
   * Extracts a readable message from an unknown error.
   *
   * @param error Unknown caught value.
   * @returns Safe log message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown Google Play collector error.';
  }
}
