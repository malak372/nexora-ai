import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import gplay from 'google-play-scraper';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorRegionUtil } from '../base/collector-region.util';
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
  date?: string | Date;
};

type GooglePlayReviewsResponse = {
  data?: GooglePlayReview[];
};

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
  readonly sourceType = CollectionSourceType.GOOGLE_PLAY;

  private readonly platformName = 'Google Play';

  constructor(configService: ConfigService) {
    super(configService, GooglePlayCollector.name);
  }

  /**
   * Collects Google Play apps, ranks them by relevance,
   * attaches useful public reviews, and maps them to CollectorPost.
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
        .sort((a, b) => b.score - a.score)
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
   * Searches Google Play apps using google-play-scraper with cache support.
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
        gplay.search({
          term: searchQuery,
          num: Math.min(this.maxFetchedPosts, 20),
          lang: this.resolveLanguage(input.language),
          country: this.resolveCountry(input.country),
        }) as Promise<GooglePlayApp[]>,
    );
  }

  /**
   * Builds search query from domain keywords, domain name, and user keywords.
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
   * Validates Google Play app before ranking and mapping.
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
   * Detects Google Play game-like apps that pollute education results.
   *
   * This is intentionally scoped to Google Play only because many Google Play
   * search results for education keywords are simulation games, not real
   * learning platforms or educational tools.
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
   * Calculates app relevance score using the shared scoring utility.
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
   * Maps a Google Play app to the unified CollectorPost format.
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
   * Collects public reviews for a Google Play app using cache support.
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
            gplay.reviews({
              appId,
              num: this.maxSavedComments,
              sort: this.getNewestSort(),
              lang: this.resolveLanguage(input.language),
              country: this.resolveCountry(input.country),
            }) as Promise<GooglePlayReviewsResponse>,
        );

      return (response.data ?? [])
        .filter((review) => this.isUsefulReview(review, input.language))
        .slice(0, this.maxSavedComments)
        .map((review): CollectorComment => ({
          externalId: review.id ?? `${appId}-${review.date}`,
          content: this.cleanPlainText(review.text),
          author: this.cleanPlainText(review.userName),
          language: input.language,
          likesCount: review.thumbsUp ?? 0,
          publishedAt: review.date ? new Date(review.date) : undefined,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Filters short, low-value, blocked, or language-mismatched reviews.
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
   * Reads common blocked words and Google Play-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GOOGLE_PLAY_BLOCKED_WORDS');
  }

  /**
   * Resolves requested language to a Google Play language code.
   */
  private resolveLanguage(language?: string): string {
    return CollectorLanguageUtil.resolveLanguageCode(language) ?? 'en';
  }

  /**
   * Resolves requested country to a Google Play country code.
   */
  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    return regionCode?.toLowerCase() ?? 'us';
  }

  /**
   * Returns google-play-scraper newest sort value.
   *
   * The package typings can differ between versions,
   * so enum access is isolated here.
   */
  private getNewestSort() {
    return (gplay.sort as any).NEWEST || 'NEWEST';
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