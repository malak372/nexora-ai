import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import gplay from 'google-play-scraper';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Google Play collector.
 *
 * Collects public Google Play app reviews using google-play-scraper.
 *
 * @author Malak
 */
@Injectable()
export class GooglePlayCollector
  extends BaseCollector
  implements SocialCollector {
  readonly sourceType = CollectionSourceType.GOOGLE_PLAY;

  private readonly platformName = 'Google Play';

  constructor(configService: ConfigService) {
    super(configService, GooglePlayCollector.name);
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Google Play collection skipped because no search keywords exist.',
        );
        return [];
      }

      const apps = await gplay.search({
        term: searchQuery,
        num: Math.min(this.maxFetchedPosts, 20),
        lang: this.resolveLanguage(input.language),
        country: this.resolveCountry(input.country),
      });

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

      this.logger.log(
        `Google Play collection completed. Apps: ${posts.length}`,
      );

      return posts;
    } catch (error: any) {
      this.logger.warn(
        'Google Play collection failed',
        error?.message ?? error,
      );

      return [];
    }
  }

  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([...domainKeywords, ...fallbackDomain, ...userKeywords])
      .slice(0, 4)
      .join(' ');
  }

  private isValidApp(app: any): boolean {
    const title = this.normalizeText(app?.title ?? '');
    const summary = this.normalizeText(app?.summary ?? '');

    if (!app?.appId || !title) return false;

    const blockedWords = this.getBlockedWords();
    const content = `${title} ${summary}`;

    return !blockedWords.some((word) => content.includes(word));
  }

  private calculateAppRelevanceScore(
    app: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: app?.title ?? '',
      body: app?.summary ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: app?.ratings ?? 0,
      replies: app?.ratings ?? 0,
      publishedAt: undefined,
    });
  }

  private async mapAppToCollectorPost(
    app: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectAppReviews(app.appId, input);

    return {
      sourceType: CollectionSourceType.GOOGLE_PLAY,
      platformName: this.platformName,
      externalId: app.appId,
      title: app.title,
      content: app.summary ?? app.title,
      author: app.developer,
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

  private async collectAppReviews(
    appId: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    try {
      const reviews = await gplay.reviews({
        appId,
        num: this.maxSavedComments,
        // google-play-scraper's sort enum typings may differ; cast to any to avoid TS errors
        sort: (gplay.sort as any).NEWEST,
        lang: this.resolveLanguage(input.language),
        country: this.resolveCountry(input.country),
      });

      return (reviews?.data ?? [])
        .filter((review: any) => this.isUsefulReview(review))
        .slice(0, this.maxSavedComments)
        .map((review: any): CollectorComment => ({
          externalId: review.id,
          content: review.text,
          author: review.userName,
          language: input.language,
          likesCount: review.thumbsUp ?? 0,
          publishedAt: review.date ? new Date(review.date) : undefined,
        }));
    } catch {
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
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GOOGLE_PLAY_BLOCKED_WORDS');
  }

  private resolveLanguage(language?: string): string {
    const normalized = this.normalizeText(language ?? '');

    if (normalized === 'ar' || normalized === 'arabic') return 'ar';
    if (normalized === 'en' || normalized === 'english') return 'en';

    return 'en';
  }

  private resolveCountry(country?: string): string {
    const normalized = this.normalizeText(country ?? '');

    if (normalized === 'palestine') return 'ps';
    if (normalized === 'jordan') return 'jo';
    if (normalized === 'saudi arabia') return 'sa';
    if (normalized === 'egypt') return 'eg';

    return 'us';
  }
}