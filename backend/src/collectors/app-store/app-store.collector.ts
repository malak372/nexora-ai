import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import appStore from 'app-store-scraper';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Apple App Store collector.
 *
 * Collects public App Store apps and reviews using app-store-scraper.
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

      const apps = await appStore.search({
        term: searchQuery,
        num: Math.min(this.maxFetchedPosts, 20),
        country: this.resolveCountry(input.country),
        lang: this.resolveLanguage(input.language),
      });

      this.logger.log(`App Store search query: ${searchQuery}`);
      this.logger.log(`App Store apps returned: ${apps.length}`);

      const rankedApps = apps
        .filter((app: any) => this.isValidApp(app))
        .map((app: any) => ({
          app,
          score: this.calculateAppRelevanceScore(app, input),
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedApps.map((item: any) =>
          this.mapAppToCollectorPost(item.app, input),
        ),
      );

      this.logger.log(`App Store collection completed. Apps: ${posts.length}`);

      return posts;
    } catch (error: any) {
      this.logger.warn('App Store collection failed', error?.message ?? error);
      return [];
    }
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

  private isValidApp(app: any): boolean {
    const appId = this.getAppId(app);

    const title = this.normalizeText(app?.title ?? '');
    const description = this.normalizeText(
      app?.description ?? app?.summary ?? '',
    );

    if (!appId || !title) return false;

    const blockedWords = this.getBlockedWords();
    const content = `${title} ${description}`;

    return !blockedWords.some((word) => content.includes(word));
  }

  private calculateAppRelevanceScore(
    app: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: app?.title ?? '',
      body: app?.description ?? app?.summary ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: app?.reviews ?? app?.ratings ?? 0,
      replies: app?.reviews ?? app?.ratings ?? 0,
      publishedAt: app?.released ? new Date(app.released) : undefined,
    });
  }

  private async mapAppToCollectorPost(
    app: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const appId = this.getAppId(app);

    const comments = await this.collectAppReviews(appId, input);

    return {
      sourceType: CollectionSourceType.APP_STORE,
      platformName: this.platformName,
      externalId: appId.toString(),
      title: app.title,
      content: app.description ?? app.summary ?? app.title,
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
      const reviews = await appStore.reviews({
        id: appId,
        page: 1,
        country: this.resolveCountry(input.country),
        sort: appStore.sort.RECENT,
      });

      return (reviews ?? [])
        .filter((review: any) => this.isUsefulReview(review))
        .slice(0, this.maxSavedComments)
        .map((review: any): CollectorComment => ({
          externalId: review.id?.toString() ?? `${appId}-${review.date}`,
          content: review.text,
          author: review.userName,
          language: input.language,
          likesCount: review.score ?? 0,
          publishedAt: review.updated
            ? new Date(review.updated)
            : review.date
              ? new Date(review.date)
              : undefined,
        }));
    } catch (error: any) {
      this.logger.warn(
        `Failed to collect reviews for app ${appId}`,
        error?.message ?? error,
      );

      return [];
    }
  }

  private isUsefulReview(review: any): boolean {
    const content = this.normalizeText(review?.text ?? '');

    if (!review?.id || content.length < 40) {
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

    return !blockedWords.some((word) => content.includes(word));
  }

  private getAppId(app: any): string | number {
    return app?.id ?? app?.appId;
  }

  protected getBlockedWords(): string[] {
    return super.getBlockedWords('APP_STORE_BLOCKED_WORDS');
  }

  private resolveLanguage(language?: string): string {
    const normalized = this.normalizeText(language ?? '');

    if (normalized === 'ar' || normalized === 'arabic') return 'ar';
    if (normalized === 'en' || normalized === 'english') return 'en';

    return 'en';
  }

  private resolveCountry(country?: string): string {
    const normalized = this.normalizeText(country ?? '');

    if (normalized === 'palestine') return 'us';
    if (normalized === 'jordan') return 'jo';
    if (normalized === 'saudi arabia') return 'sa';
    if (normalized === 'egypt') return 'eg';

    return 'us';
  }
}