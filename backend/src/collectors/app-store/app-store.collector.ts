import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import appStore from 'app-store-scraper';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorRegionUtil } from '../base/collector-region.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

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

type AppStoreReview = {
  id?: string | number;
  text?: string;
  userName?: string;
  score?: number;
  updated?: string | Date;
  date?: string | Date;
};

/**
 * Apple App Store collector.
 *
 * Collects public App Store apps and public user reviews using
 * app-store-scraper.
 *
 * Notes:
 * - App Store search requires a supported storefront country code.
 * - If a country is not supported or not provided, US is used as fallback.
 *
 * @author Malak
 */
@Injectable()
export class AppStoreCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.APP_STORE;

  private readonly platformName = 'App Store';

  constructor(configService: ConfigService) {
    super(configService, AppStoreCollector.name);
  }

  /**
   * Collects App Store apps matching the selected domain/search input,
   * ranks them by relevance, and attaches useful public reviews.
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

      const apps = (await appStore.search({
        term: searchQuery,
        num: Math.min(this.maxFetchedPosts, 20),
        country: this.resolveCountry(input.country),
        lang: this.resolveLanguage(input.language),
      })) as AppStoreApp[];

      this.logger.log(`App Store search query: ${searchQuery}`);
      this.logger.log(`App Store apps returned: ${apps.length}`);

      const rankedApps = apps
        .filter((app) => this.isValidApp(app))
        .map((app) => ({
          app,
          score: this.calculateAppRelevanceScore(app, input),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedApps.map((item) => this.mapAppToCollectorPost(item.app, input)),
      );

      this.logger.log(`App Store collection completed. Apps: ${posts.length}`);

      return posts;
    } catch (error: unknown) {
      this.logger.warn(
        'App Store collection failed',
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  /**
   * Builds the App Store search query.
   *
   * Priority:
   * 1. User keyword.
   * 2. Domain name.
   * 3. First domain keyword.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const userKeyword = input.keywords?.[0]
      ? this.normalizeText(input.keywords[0])
      : '';

    if (userKeyword) return userKeyword;

    if (input.domainName) {
      return this.normalizeText(input.domainName);
    }

    return this.getDomainKeywords(input)[0] ?? '';
  }

  /**
   * Checks whether an app has enough required data and is not blocked.
   */
  private isValidApp(app: AppStoreApp): boolean {
    const appId = this.getAppId(app);

    const title = this.normalizeText(app.title ?? '');
    const description = this.normalizeText(app.description ?? app.summary ?? '');

    if (!appId || !title) return false;

    const blockedWords = this.getAppStoreBlockedWords();
    const content = `${title} ${description}`;

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Calculates relevance score using the shared scoring utility.
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
   * Maps an App Store app to the unified CollectorPost format.
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
      externalId: appId.toString(),
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
   * Collects recent public reviews for a specific App Store app.
   */
  private async collectAppReviews(
    appId: string | number,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    try {
      const reviews = (await appStore.reviews({
        id: appId,
        page: 1,
        country: this.resolveCountry(input.country),
        sort: appStore.sort.RECENT,
      })) as AppStoreReview[];

      return (reviews ?? [])
        .filter((review) => this.isUsefulReview(review, input.language))
        .slice(0, this.maxSavedComments)
        .map((review): CollectorComment => ({
          externalId: review.id?.toString() ?? `${appId}-${review.date}`,
          content: review.text ?? '',
          author: review.userName,
          language: input.language,
          likesCount: review.score ?? 0,
          publishedAt: review.updated
            ? new Date(review.updated)
            : review.date
              ? new Date(review.date)
              : undefined,
        }));
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to collect reviews for app ${appId}`,
        error instanceof Error ? error.message : error,
      );

      return [];
    }
  }

  /**
   * Filters out short, low-value, blocked, or language-mismatched reviews.
   */
  private isUsefulReview(
    review: AppStoreReview,
    language?: string,
  ): boolean {
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
   * Extracts the app identifier from app-store-scraper response.
   */
  private getAppId(app: AppStoreApp): string | number {
    return app.id ?? app.appId ?? '';
  }

  /**
   * Reads common blocked words and App Store-specific blocked words.
   */
  private getAppStoreBlockedWords(): string[] {
    return super.getBlockedWords('APP_STORE_BLOCKED_WORDS');
  }

  /**
   * Resolves the requested language to an App Store-supported language code.
   */
  private resolveLanguage(language?: string): string {
    return CollectorLanguageUtil.resolveLanguageCode(language) ?? 'en';
  }

  /**
   * Resolves country into App Store storefront code.
   *
   * Palestine is mapped to US because App Store storefront support
   * for Palestine is not reliably available in app-store-scraper.
   */
  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    if (!regionCode) return 'us';
    if (regionCode === 'PS') return 'us';

    return regionCode.toLowerCase();
  }
}