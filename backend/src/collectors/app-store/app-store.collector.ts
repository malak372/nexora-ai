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

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
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
 * - External app-store-scraper calls are cached through
 *   CollectorExternalCacheUtil.
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
        appStore.search({
          term: searchQuery,
          country: this.resolveCountry(input.country),
          num: this.maxFetchedPosts,
        }) as Promise<AppStoreApp[]>,
    );
  }

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

  private isValidApp(app: AppStoreApp): boolean {
    const appId = this.getAppId(app);
    const title = this.normalizeText(app.title ?? '');
    const description = this.normalizeText(app.description ?? app.summary ?? '');

    if (!appId || !title) return false;

    const blockedWords = this.getAppStoreBlockedWords();
    const content = `${title} ${description}`;

    return !blockedWords.some((word) => content.includes(word));
  }

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
      >(
        cacheKey,
        this.cacheTtlMs,
        () =>
          appStore.reviews({
            id: appId,
            country: this.resolveCountry(input.country),
          }) as Promise<AppStoreReview[]>,
      );

      return reviews
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

  private isUsefulReview(review: AppStoreReview, language?: string): boolean {
    const rawContent = review.text ?? '';
    const content = this.normalizeText(rawContent);

    if (!review.id || content.length < 40) return false;

    if (!CollectorLanguageUtil.matchesRequestedLanguage(rawContent, language)) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) return false;

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

    if (lowValueReviews.has(content)) return false;

    const blockedWords = this.getAppStoreBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  private getAppId(app: AppStoreApp): string | number {
    return app.id ?? app.appId ?? '';
  }

  private resolveCountry(country?: string): string {
    const regionCode = CollectorRegionUtil.resolveRegionCode(country);

    if (!regionCode || regionCode === 'PS') {
      return 'us';
    }

    return regionCode.toLowerCase();
  }

  private getAppStoreBlockedWords(): string[] {
    return super.getBlockedWords('APP_STORE_BLOCKED_WORDS');
  }
}