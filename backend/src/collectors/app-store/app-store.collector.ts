import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorExternalCacheUtil } from '../base/collector-external-cache.util';
import {
  type CollectorRequestSupportInput,
  SocialCollector,
} from '../base/collector.interface';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorRegionUtil } from '../base/collector-region.util';

import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { RequestReviewStoreQueryUtil } from '../../ideas/generation/utils/request-review-store-query.util';

/**
 * Represents an App Store application normalized from the public
 * Apple iTunes Search API.
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
 * Represents an App Store review normalized from Apple's public
 * customer-review RSS JSON feed.
 */
type AppStoreReview = {
  id?: string | number;
  text?: string;
  userName?: string;
  score?: number;
  updated?: string | Date;
  date?: string | Date;
};

type ItunesSearchResult = {
  trackId?: number;
  bundleId?: string;
  trackName?: string;
  description?: string;
  sellerName?: string;
  artistName?: string;
  trackViewUrl?: string;
  userRatingCount?: number;
  averageUserRating?: number;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
};

type ItunesSearchResponse = {
  resultCount?: number;
  results?: ItunesSearchResult[];
};

type ItunesReviewEntry = {
  id?: { label?: string };
  content?: { label?: string };
  author?: { name?: { label?: string } };
  updated?: { label?: string };
  'im:rating'?: { label?: string };
};

type ItunesReviewFeedResponse = {
  feed?: { entry?: ItunesReviewEntry[] };
};

/**
 * Apple App Store collector.
 *
 * Collects public applications and public reviews using
 * Apple public App Store endpoints.
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

  supportsRequest(input: CollectorRequestSupportInput): boolean {
    const bounded =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';
    if (!bounded) return true;

    const corpus = [
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.keywords ?? []),
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    if (!corpus) return false;

    // Review stores can only produce useful evidence when the affected
    // workflow is itself a digital/mobile product or when the retrieval plan
    // explicitly asks for app-review evidence. Physical-service/craft requests
    // are not routed here merely because a generic "manager" app could exist.
    return /\b(?:mobile app|mobile application|android app|ios app|web app|software|saas|digital platform|online platform|customer portal|user portal|account login|sign in|sync|app crash|application crash|app review|user review|store review|app store|google play)\b/u.test(corpus);
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
        searchQueries.map((query) =>
          this.settleWithinSoftBudget(
            this.searchApps(query, input),
            6_500,
            [],
            `App Store app discovery for "${query}"`,
          ),
        ),
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
            ? Math.min(3, this.resolveMaxSavedPosts(input))
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
        this.fetchAppsFromApple(
          searchQuery,
          'us',
          Math.min(this.resolveMaxFetchedPosts(input), 25),
        ),
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
      this.fetchAppsFromApple(searchQuery, country, num);

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

  /**
   * Searches Apple's public iTunes Search API and normalizes software results
   * to the collector's internal application shape. This removes the legacy
   * legacy scraper dependency and its vulnerable request stack.
   */
  private async fetchAppsFromApple(
    term: string,
    country: string,
    limit: number,
  ): Promise<AppStoreApp[]> {
    const response = await axios.get<ItunesSearchResponse>(
      'https://itunes.apple.com/search',
      {
        params: {
          term,
          country,
          entity: 'software',
          media: 'software',
          limit: Math.max(1, Math.min(limit, 25)),
        },
        timeout: 6_000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Voxidence/1.0',
        },
      },
    );

    return (response.data.results ?? []).map((app) => ({
      id: app.trackId,
      appId: app.bundleId,
      title: app.trackName,
      description: app.description,
      summary: app.description,
      developer: app.sellerName ?? app.artistName,
      url: app.trackViewUrl,
      reviews: app.userRatingCount,
      ratings: app.averageUserRating,
      released: app.currentVersionReleaseDate ?? app.releaseDate,
    }));
  }

  /**
   * Reads Apple's public customer-review RSS feed and normalizes review
   * entries. The first feed entry may describe the application itself, so
   * only entries with review content are retained.
   */
  private async fetchReviewsFromApple(
    appId: string | number,
    country: string,
  ): Promise<AppStoreReview[]> {
    const normalizedCountry = country.toLowerCase();
    const encodedAppId = encodeURIComponent(String(appId));
    const url =
      `https://itunes.apple.com/${normalizedCountry}/rss/customerreviews/` +
      `page=1/id=${encodedAppId}/sortby=mostrecent/json`;

    const response = await axios.get<ItunesReviewFeedResponse>(url, {
      timeout: 7_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Voxidence/1.0',
      },
    });

    return (response.data.feed?.entry ?? [])
      .filter((entry) => Boolean(entry.content?.label))
      .map((entry) => {
        const rawScore = Number(entry['im:rating']?.label);

        return {
          id: entry.id?.label,
          text: entry.content?.label,
          userName: entry.author?.name?.label,
          score: Number.isFinite(rawScore) ? rawScore : undefined,
          updated: entry.updated?.label,
        };
      });
  }

  /** Builds focused queries instead of relying on one broad domain term. */
  private buildSearchQueries(input: CollectorInput): string[] {
    if (input.authoritativePlannedQueries && (input.plannedQueries?.length ?? 0) > 0) {
      const boundedBudget = input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3;
      return this.unique(
        (input.plannedQueries ?? []).map((query) => query.trim()).filter(Boolean),
      ).slice(0, boundedBudget);
    }

    const reviewStoreQueries = RequestReviewStoreQueryUtil.build({
      requestDescription: input.requestDescription,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries ?? [],
      maxQueries:
        input.collectionMode === 'TARGETED_RECOVERY' ? 3 : 4,
    });
    if (reviewStoreQueries.length > 0) {
      return reviewStoreQueries;
    }

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
        input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3;
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

    /*
     * The store is a discovery source, not the final relevance judge. Requiring
     * an entire long request/domain phrase here used to hide useful apps before
     * their reviews could ever reach Community AI. Keep only a light lexical
     * identity/workflow gate and let all returned reviews be semantically
     * classified by Community downstream.
     */
    const stopWords = new Set([
      'often', 'frequently', 'usually', 'struggle', 'struggles', 'manage',
      'management', 'problem', 'problems', 'difficult', 'difficulty', 'the',
      'and', 'for', 'with', 'from', 'into', 'across', 'separately', 'higher',
      'lower', 'delayed', 'delay', 'inaccurate', 'unnecessary',
    ]);
    const requestTokens = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.plannedQueries ?? []).slice(0, 4),
      ...(input.keywords ?? []).slice(0, 6),
    ].join(' '))
      .split(/\s+/u)
      .filter((token) => token.length >= 4 && !stopWords.has(token));
    const searchableTokens = new Set(searchableText.split(/\s+/u));
    const overlap = [...new Set(requestTokens)].filter((token) =>
      searchableTokens.has(token),
    );

    return overlap.length >= 1;
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
        input.collectionMode === 'FAST_GENERATION' ||
        input.collectionMode === 'TARGETED_RECOVERY'
          ? 'us'
          : this.resolveCountry(input.country);
      let reviews: AppStoreReview[];

      try {
        reviews = await this.settleWithinSoftBudget(
          CollectorExternalCacheUtil.remember<AppStoreReview[]>(
            cacheKey,
            this.cacheTtlMs,
            () =>
              this.fetchReviewsFromApple(appId, requestedCountry),
          ),
          7_500,
          [],
          `App Store reviews for ${String(appId)}`,
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

        reviews = await this.settleWithinSoftBudget(
          CollectorExternalCacheUtil.remember<AppStoreReview[]>(
            fallbackCacheKey,
            this.cacheTtlMs,
            () => this.fetchReviewsFromApple(appId, 'us'),
          ),
          7_500,
          [],
          `App Store US fallback reviews for ${String(appId)}`,
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