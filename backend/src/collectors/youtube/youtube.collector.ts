import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';

import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { CollectorQueryBuilderUtil } from '../base/collector-query-builder.util';
import { CollectorRegionUtil } from '../base/collector-region.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';

type YouTubeVideoId = {
  videoId?: string;
};

type YouTubeSnippet = {
  title?: string;
  description?: string;
  channelTitle?: string;
  publishedAt?: string;
};

type YouTubeSearchVideo = {
  id?: YouTubeVideoId;
  snippet?: YouTubeSnippet;
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchVideo[];
};

type YouTubeVideoStatistics = {
  likeCount: number;
  commentCount: number;
};

type YouTubeVideoStatisticsItem = {
  id?: string;
  statistics?: {
    likeCount?: string;
    commentCount?: string;
  };
};

type YouTubeStatisticsResponse = {
  items?: YouTubeVideoStatisticsItem[];
};

type YouTubeTopLevelComment = {
  id?: string;
  snippet?: {
    textDisplay?: string;
    authorDisplayName?: string;
    likeCount?: number;
    publishedAt?: string;
  };
};

type YouTubeCommentThread = {
  snippet?: {
    topLevelComment?: YouTubeTopLevelComment;
  };
};

type YouTubeCommentsResponse = {
  items?: YouTubeCommentThread[];
};

/**
 * YouTube collector.
 *
 * Collects public videos and top-level comments using
 * YouTube Data API v3.
 *
 * @author Malak
 */
@Injectable()
export class YouTubeCollector extends BaseCollector implements SocialCollector {
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'youtube';

  private readonly apiBaseUrl = 'https://www.googleapis.com/youtube/v3';

  private readonly maxSearchQueries: number;
  private static quotaCircuitOpenUntil = 0;
  private static readonly DAILY_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  private static readonly TRANSIENT_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;

  constructor(configService: ConfigService) {
    super(configService, YouTubeCollector.name);

    this.maxSearchQueries = this.getPositiveNumber(
      'COLLECTOR_MAX_SEARCH_QUERIES',
      2,
    );
  }

  /**
   * Runtime availability includes the shared quota circuit, not only API-key
   * presence. This lets later recovery waves and subsequent generation runs
   * rotate away from YouTube immediately after a daily quota/rate limit is
   * detected instead of spending another source slot on a known-empty call.
   */
  isRuntimeAvailable(): boolean {
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY')?.trim();
    return Boolean(apiKey) && YouTubeCollector.quotaCircuitOpenUntil <= Date.now();
  }

  getRuntimeUnavailableReason(): string | null {
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY')?.trim();
    if (!apiKey) return 'YouTube API key is not configured.';
    if (YouTubeCollector.quotaCircuitOpenUntil > Date.now()) {
      return 'YouTube quota/rate-limit circuit is currently open.';
    }
    return null;
  }

  /**
   * Collects public YouTube videos and comments.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    if (YouTubeCollector.quotaCircuitOpenUntil > Date.now()) {
      const remainingSeconds = Math.ceil(
        (YouTubeCollector.quotaCircuitOpenUntil - Date.now()) / 1000,
      );
      this.logger.warn(
        `YouTube collection skipped because the quota/rate-limit circuit is open for approximately ${remainingSeconds}s.`,
      );
      return [];
    }

    const apiKey = this.getApiKey();

    const searchQueries = this.buildSearchQueries(input).slice(
      0,
      input.collectionMode === 'TARGETED_RECOVERY'
        ? 1
        : this.maxSearchQueries,
    );

    if (!searchQueries.length) {
      this.logger.warn(
        'YouTube collection skipped because no domain keywords exist.',
      );

      return [];
    }

    try {
      /*
       * YouTube search quota is expensive and a quota failure applies to every
       * query in the same collection wave. Execute the bounded search lanes
       * adaptively: stop as soon as enough relevant videos exist, and stop
       * immediately after the shared rate-limit circuit opens. This prevents a
       * single 429 from being multiplied by already-unnecessary fallback calls.
       */
      const firstPassItems: Array<{
        video: YouTubeSearchVideo;
        statistics?: YouTubeVideoStatistics;
        score: number;
      }> = [];

      for (const query of searchQueries) {
        if (YouTubeCollector.quotaCircuitOpenUntil > Date.now()) break;
        try {
          const videos = await this.searchVideos(input, apiKey, query);
          const validVideos = videos
            .filter((video) => this.isValidVideo(video))
            .filter((video) => this.matchesInputContext(video, input));
          const videoIds = validVideos
            .map((video) => video.id?.videoId)
            .filter((videoId): videoId is string => Boolean(videoId));
          const statisticsMap = await this.fetchVideoStatistics(videoIds, apiKey);

          firstPassItems.push(
            ...validVideos
              .map((video) => {
                const videoId = video.id?.videoId;
                const statistics = videoId
                  ? statisticsMap.get(videoId)
                  : undefined;
                return {
                  video,
                  statistics,
                  score: this.calculateVideoRelevanceScore(
                    video,
                    input,
                    statistics,
                  ),
                };
              })
              .filter((item) => item.score > 5),
          );

          if (firstPassItems.length >= 2) break;
        } catch (error: unknown) {
          const cooldownMs = this.resolveRateLimitCooldownMs(error);
          if (cooldownMs > 0) {
            YouTubeCollector.quotaCircuitOpenUntil = Math.max(
              YouTubeCollector.quotaCircuitOpenUntil,
              Date.now() + cooldownMs,
            );
            this.logger.warn(
              `YouTube rate-limit circuit opened for ${Math.ceil(cooldownMs / 1000)}s; later collection/recovery waves will skip YouTube instead of repeating exhausted requests.`,
            );
            break;
          }
        }
      }

      const rankVideos = (items: Array<{
        video: YouTubeSearchVideo;
        statistics?: YouTubeVideoStatistics;
        score: number;
      }>) => {
        const seenVideoIds = new Set<string>();
        return items
          .sort((first, second) => second.score - first.score)
          .filter((item) => {
            const videoId = item.video.id?.videoId;
            if (!videoId || seenVideoIds.has(videoId)) {
              return false;
            }
            seenVideoIds.add(videoId);
            return true;
          })
          .slice(0, this.maxSavedPosts);
      };

      let selectedVideos = rankVideos(firstPassItems);

      if (
        selectedVideos.length < 2 &&
        input.requestDescription?.trim() &&
        YouTubeCollector.quotaCircuitOpenUntil <= Date.now()
      ) {
        const attempted = new Set(
          searchQueries.map((query) => this.cleanNormalizedText(query)),
        );
        const fallbackQueries = ProblemFirstCollectorQueryUtil.buildProgressiveFallback({
          sourceKey: this.sourceKey,
          domainName: input.domainName,
          requestDescription: input.requestDescription,
          plannedQueries: input.plannedQueries,
          keywords: input.keywords,
          authoritativePlannedQueries: input.authoritativePlannedQueries,
        })
          .filter((query) => !attempted.has(this.cleanNormalizedText(query)))
          .slice(0, 2);

        const fallbackResults = await Promise.allSettled(
          fallbackQueries.map(async (query) => {
            const videos = await this.searchVideos(input, apiKey, query);
            const validVideos = videos
              .filter((video) => this.isValidVideo(video))
              .filter((video) => this.matchesInputContext(video, input));
            const videoIds = validVideos
              .map((video) => video.id?.videoId)
              .filter((videoId): videoId is string => Boolean(videoId));
            const statisticsMap = await this.fetchVideoStatistics(videoIds, apiKey);

            return validVideos
              .map((video) => {
                const videoId = video.id?.videoId;
                const statistics = videoId ? statisticsMap.get(videoId) : undefined;
                return {
                  video,
                  statistics,
                  score: this.calculateVideoRelevanceScore(video, input, statistics),
                };
              })
              .filter((item) => item.score > 5);
          }),
        );

        selectedVideos = rankVideos([
          ...selectedVideos,
          ...fallbackResults.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : [],
          ),
        ]);
      }

      /*
       * Comment threads are also independent. Fetch them concurrently for the
       * already-ranked bounded video set; this removes the previous one-video-
       * at-a-time comment latency while keeping the same evidence limits.
       */
      const collectedPosts = (await Promise.allSettled(
        selectedVideos.map((item) =>
          this.mapVideoToCollectorPost(
            item.video,
            input,
            item.statistics,
          ),
        ),
      )).flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );

      /*
       * maxSavedComments is historically a per-video cap. For request-driven
       * generation that allowed a small number of videos to fan out into
       * hundreds of comments. Apply a second source-wide budget before
       * persistence so FAST_GENERATION/TARGETED_RECOVERY never inflate the raw
       * corpus merely because several videos each have useful comments.
       */
      const sourceCommentBudget =
        input.collectionMode === 'FAST_GENERATION'
          ? Math.min(8, Math.max(2, this.resolveMaxSavedComments(input) * 4))
          : input.collectionMode === 'TARGETED_RECOVERY'
            ? Math.min(6, Math.max(2, this.resolveMaxSavedComments(input) * 3))
            : Number.POSITIVE_INFINITY;
      let remainingCommentBudget = sourceCommentBudget;
      const boundedPosts = collectedPosts.map((post) => {
        if (!Number.isFinite(sourceCommentBudget)) return post;
        const comments = post.comments.slice(
          0,
          Math.max(0, remainingCommentBudget),
        );
        remainingCommentBudget -= comments.length;
        return { ...post, comments };
      });

      const retainedComments = boundedPosts.reduce(
        (sum, post) => sum + post.comments.length,
        0,
      );
      this.logger.log(
        `YouTube collection completed. Posts: ${boundedPosts.length} | retainedComments=${retainedComments}`,
      );

      return boundedPosts;
    } catch (error: unknown) {
      this.logger.error(
        'YouTube collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'YouTube collection failed. Check YouTube API key, collector limits, quota limits, or network connection.',
      );
    }
  }

  /**
   * Searches YouTube videos.
   */
  private async searchVideos(
    input: CollectorInput,
    apiKey: string,
    query: string,
  ): Promise<YouTubeSearchVideo[]> {
    if (YouTubeCollector.quotaCircuitOpenUntil > Date.now()) {
      return [];
    }

    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'search', [
      query,
      input.country,
      input.language,
    ]);

    const data =
      await CollectorHttpUtil.getWithRetryAndCache<YouTubeSearchResponse>(
        `${this.apiBaseUrl}/search`,
        {
          params: this.buildSearchParams(input, apiKey, query),
          timeout: 10_000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
          retryOnRateLimit: false,
        },
      );

    return data.items ?? [];
  }

  private resolveRateLimitCooldownMs(error: unknown): number {
    const message = this.getErrorMessage(error).toLocaleLowerCase();
    const responseData =
      typeof error === 'object' &&
      error !== null &&
      'response' in error
        ? JSON.stringify(
            (error as { readonly response?: { readonly data?: unknown } }).response
              ?.data ?? '',
          ).toLocaleLowerCase()
        : '';
    const diagnostic = `${message} ${responseData}`;
    const isRateLimited =
      diagnostic.includes('status code 429') ||
      diagnostic.includes('\"code\":429') ||
      diagnostic.includes('rate_limit_exceeded') ||
      diagnostic.includes('ratelimitexceeded') ||
      diagnostic.includes('resource_exhausted') ||
      diagnostic.includes('quota exceeded');

    if (!isRateLimited) return 0;

    /*
     * Axios' top-level message is often only "Request failed with status code
     * 429". Inspect the provider response body as well so the documented
     * per-day Search Queries quota opens the shared daily circuit rather than
     * the old 60-second transient circuit.
     */
    const isDailyQuota =
      diagnostic.includes('per day') ||
      diagnostic.includes('search queries per day') ||
      diagnostic.includes('defaultsearchlistperdayperproject') ||
      diagnostic.includes('quota_unit\":\"1/d') ||
      diagnostic.includes('quota exceeded for quota metric');

    return isDailyQuota
      ? YouTubeCollector.DAILY_QUOTA_COOLDOWN_MS
      : YouTubeCollector.TRANSIENT_RATE_LIMIT_COOLDOWN_MS;
  }

  /**
   * Builds YouTube API search parameters.
   */
  private buildSearchParams(
    input: CollectorInput,
    apiKey: string,
    query: string,
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      key: apiKey,
      part: 'snippet',
      type: 'video',
      q: query,
      order: 'relevance',
      maxResults: Math.min(this.maxFetchedPosts, 50),
      safeSearch: 'moderate',
      videoDuration: 'medium',
      videoEmbeddable: 'true',
    };

    const regionCode = CollectorRegionUtil.resolveRegionCode(input.country);

    const relevanceLanguage = CollectorLanguageUtil.resolveLanguageCode(
      input.language,
    );

    if (regionCode) {
      params.regionCode = regionCode;
    }

    if (relevanceLanguage) {
      params.relevanceLanguage = relevanceLanguage;
    }

    return params;
  }

  /**
   * Builds YouTube search queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const isBoundedMode =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';
    const maximumQueries = isBoundedMode ? 3 : this.maxSearchQueries;
    if (input.requestDescription?.trim()) {
      return ProblemFirstCollectorQueryUtil.build({
        sourceKey: this.sourceKey,
        domainName: input.domainName,
        requestDescription: input.requestDescription,
        plannedQueries: input.plannedQueries,
        keywords: input.keywords,
        authoritativePlannedQueries: input.authoritativePlannedQueries,
      }).slice(0, maximumQueries);
    }

    const plannedQueries = (input.plannedQueries ?? [])
      .map((query) => this.cleanNormalizedText(query))
      .map((query) => query.split(/\s+/u).slice(0, 9).join(' '))
      .filter(Boolean);
    const anchoredQueries = CollectorQueryBuilderUtil.buildYouTubeAnchoredQueries({
      domainName: input.domainName,
      userKeywords: [
        ...(input.domainKeywords ?? []),
        ...(input.keywords ?? []),
      ],
      maxQueries: maximumQueries,
    });

    return this.unique([...plannedQueries, ...anchoredQueries]).slice(
      0,
      maximumQueries,
    );
  }

  /**
   * Validates one search result.
   */
  private isValidVideo(video: YouTubeSearchVideo): boolean {
    const videoId = video.id?.videoId;

    const title = this.cleanPlainText(video.snippet?.title);

    const description = this.cleanPlainText(video.snippet?.description);

    const channelTitle = this.cleanPlainText(video.snippet?.channelTitle);

    const content = this.cleanNormalizedText(
      `${title} ${description} ${channelTitle}`,
    );

    const blockedWords = this.getBlockedWords();

    return (
      Boolean(videoId) &&
      Boolean(title) &&
      !blockedWords.some((word) =>
        content.includes(this.cleanNormalizedText(word)),
      )
    );
  }

  /**
   * Validates requested language context.
   */
  private matchesInputContext(
    video: YouTubeSearchVideo,
    input: CollectorInput,
  ): boolean {
    const content = this.cleanPlainText(
      `${video.snippet?.title ?? ''} ${video.snippet?.description ?? ''}`,
    );

    const languageMatches = CollectorLanguageUtil.matchesRequestedLanguage(
      content,
      input.language,
    );

    if (!languageMatches) {
      return false;
    }

    const normalized = this.cleanNormalizedText(content);

    if (
      input.requestDescription?.trim() &&
      (input.collectionMode === 'FAST_GENERATION' ||
        input.collectionMode === 'TARGETED_RECOVERY')
    ) {
      const constraint = RequestVerticalConstraintUtil.resolve({
        requestDescription: input.requestDescription,
        domainName: input.domainName,
        plannedQueries: input.plannedQueries,
      });

      if (constraint.strict) {
        const verticalMatch = RequestVerticalConstraintUtil.matchesVertical(
          content,
          constraint,
        );
        if (!verticalMatch) {
          return false;
        }

        const workflowMatch = RequestVerticalConstraintUtil.matchesWorkflow(
          content,
          constraint,
        );
        const serviceContainerMatch =
          constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
          /\b(?:shop|business|service|specialist|technician|cleaner|restoration|repair|workshop|customer|client|intake|pickup)\b/iu.test(
            normalized,
          );

        /*
         * A service-specific parent video may contain the useful first-person
         * pain only in its comments. Keep those containers, but never keep a
         * generic video that merely shares one broad token with the request.
         */
        if (!workflowMatch && !serviceContainerMatch) {
          return false;
        }
      }
    }

    if (input.collectionMode !== 'TARGETED_RECOVERY') {
      return true;
    }

    const planned = this.cleanNormalizedText(
      (input.plannedQueries ?? []).join(' '),
    );

    if (
      /(?:musical instrument|instrument repair|repair shop|luthier|technician|repair ticket|pickup)/iu.test(
        planned,
      )
    ) {
      const instrumentAnchor =
        /(?:musical instrument|instrument|guitar|violin|piano|saxophone|clarinet|trumpet|luthier)/iu.test(
          normalized,
        );
      const repairAnchor =
        /(?:repair|technician|service ticket|work order|parts?|pickup|intake|bench note|repair status|repair shop)/iu.test(
          normalized,
        );
      return instrumentAnchor && repairAnchor;
    }

    if (
      /(?:smart city|municipal|city technology|traffic light|parking sensor|public camera|environmental monitor|iot)/iu.test(
        planned,
      ) &&
      /(?:security|unauthorized|outdated|firmware|compromised|vulnerab|unmanaged|anomal|visibility)/iu.test(
        planned,
      )
    ) {
      const infrastructureAnchor =
        /(?:smart city|municipal|city network|traffic light|traffic signal|parking sensor|public camera|environmental monitor|iot|connected device|sensor)/iu.test(
          normalized,
        );
      const securityAnchor =
        /(?:security|cyber|unauthorized|unmanaged|outdated|firmware|compromised|vulnerab|anomal|rogue|intrusion|breach|attack|visibility)/iu.test(
          normalized,
        );
      return infrastructureAnchor && securityAnchor;
    }

    if (
      /(?:manufacturing|manufacturer|factory|production line|industrial plant)/iu.test(planned) &&
      /(?:raw material|supplier|supply chain|inventory|warehouse|shipment|production schedule|bottleneck|demand change|order prioritization)/iu.test(planned)
    ) {
      const manufacturingAnchor = /(?:manufacturing|manufacturer|factory|production|plant|industrial)/iu.test(normalized);
      const supplyAnchor = /(?:raw materials?|supplier|supply chain|inventory|warehouse|shipment|delivery|stock)/iu.test(normalized);
      const disruptionAnchor = /(?:delay|shortage|stockout|bottleneck|disrupt|shutdown|downtime|demand change|forecast|inventory mismatch|excess stock|overstock|priorit|schedule conflict)/iu.test(normalized);
      return manufacturingAnchor && supplyAnchor && disruptionAnchor;
    }

    if (
      /(?:locksmith|locksmiths|field service|mobile service|service dispatch)/iu.test(planned) &&
      /(?:dispatch|technician|service request|emergency call|tools?|replacement parts?|parts inventory|availability|repeated trips?)/iu.test(planned)
    ) {
      const locksmithAnchor = /(?:locksmith|locksmiths|lock service|lock repair|key service)/iu.test(normalized);
      const operationsAnchor = /(?:dispatch|dispatcher|technician|service call|service request|emergency call|job assignment|parts?|tools?|van inventory|mobile inventory|scheduling|availability)/iu.test(normalized);
      const failureAnchor = /(?:delay|late|missing|wrong|incorrect|unavailable|repeat trip|repeated trip|return trip|miscommunication|missed call|poor coordination|stockout|out of stock)/iu.test(normalized);
      return locksmithAnchor && operationsAnchor && failureAnchor;
    }

    const plannedTokens = planned
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 5)
      .filter(
        (token) =>
          !/^(?:about|after|before|current|different|management|platform|problem|problems|software|system|systems|tracking|workflow)$/iu.test(
            token,
          ),
      )
      .slice(0, 8);
    if (plannedTokens.length > 0) {
      const matches = plannedTokens.filter((token) => normalized.includes(token));
      if (matches.length >= Math.min(2, plannedTokens.length)) return true;
    }

    const domainName = this.cleanNormalizedText(input.domainName ?? '');
    if (!domainName) return true;

    const domainTokens = domainName
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4)
      .filter((token) => !/^(?:management|tracking|system|platform)$/iu.test(token));
    return domainTokens.some((token) => normalized.includes(token));
  }

  /**
   * Calculates video relevance.
   */
  private calculateVideoRelevanceScore(
    video: YouTubeSearchVideo,
    input: CollectorInput,
    statistics?: YouTubeVideoStatistics,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(video.snippet?.title),

      body: this.cleanPlainText(video.snippet?.description),

      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),

      likes: statistics?.likeCount ?? 0,
      replies: statistics?.commentCount ?? 0,

      publishedAt: this.parseDate(video.snippet?.publishedAt),
    });
  }

  /**
   * Maps one YouTube video.
   */
  private async mapVideoToCollectorPost(
    video: YouTubeSearchVideo,
    input: CollectorInput,
    statistics?: YouTubeVideoStatistics,
  ): Promise<CollectorPost> {
    const videoId = video.id?.videoId ?? '';
    const snippet = video.snippet ?? {};

    const title = this.cleanPlainText(snippet.title);
    const description = this.cleanPlainText(snippet.description);

    const comments = await this.collectVideoComments(videoId, input);

    return {
      externalId: videoId,
      title,
      content: description || title,

      author: this.cleanPlainText(snippet.channelTitle),

      url: `https://www.youtube.com/watch?v=${videoId}`,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: statistics?.likeCount ?? 0,

      repliesCount: statistics?.commentCount ?? comments.length,

      publishedAt: this.parseDate(snippet.publishedAt),

      comments,
    };
  }

  /**
   * Fetches video engagement statistics.
   */
  private async fetchVideoStatistics(
    videoIds: string[],
    apiKey: string,
  ): Promise<Map<string, YouTubeVideoStatistics>> {
    const statisticsMap = new Map<string, YouTubeVideoStatistics>();

    if (!videoIds.length) {
      return statisticsMap;
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'statistics', [
        videoIds.join(','),
      ]);

      const data =
        await CollectorHttpUtil.getWithRetryAndCache<YouTubeStatisticsResponse>(
          `${this.apiBaseUrl}/videos`,
          {
            params: {
              key: apiKey,
              part: 'statistics',
              id: videoIds.join(','),
            },
            timeout: 10_000,
          },
          {
            cacheKey,
            cacheTtlMs: this.cacheTtlMs,
            retryAttempts: this.retryAttempts,
            retryDelayMs: this.retryDelayMs,
          },
        );

      for (const video of data.items ?? []) {
        if (!video.id) {
          continue;
        }

        statisticsMap.set(video.id, {
          likeCount: this.toNonNegativeNumber(video.statistics?.likeCount),

          commentCount: this.toNonNegativeNumber(
            video.statistics?.commentCount,
          ),
        });
      }

      return statisticsMap;
    } catch (error: unknown) {
      this.logger.warn(
        'YouTube video-statistics collection failed.',
        this.getErrorMessage(error),
      );

      return statisticsMap;
    }
  }

  /**
   * Collects useful top-level comments.
   */
  private async collectVideoComments(
    videoId: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!videoId) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'comments', [
        videoId,
      ]);

      const data =
        await CollectorHttpUtil.getWithRetryAndCache<YouTubeCommentsResponse>(
          `${this.apiBaseUrl}/commentThreads`,
          {
            params: {
              key: this.getApiKey(),
              part: 'snippet',
              videoId,
              maxResults: Math.min(this.maxFetchedComments, 100),
              order: 'relevance',
              textFormat: 'plainText',
            },
            timeout: 10_000,
          },
          {
            cacheKey,
            cacheTtlMs: this.cacheTtlMs,
            retryAttempts: this.retryAttempts,
            retryDelayMs: this.retryDelayMs,
          },
        );

      const seenCommentIds = new Set<string>();

      return (data.items ?? [])
        .map((item) => item.snippet?.topLevelComment)
        .filter((comment): comment is YouTubeTopLevelComment =>
          Boolean(comment),
        )
        .filter((comment) => this.isUsefulComment(comment, input))
        .filter((comment) => {
          const id = comment.id;

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);

          return true;
        })
        .sort(
          (first, second) =>
            (second.snippet?.likeCount ?? 0) - (first.snippet?.likeCount ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: comment.id ?? '',

            content: this.cleanPlainText(comment.snippet?.textDisplay),

            author: this.cleanPlainText(comment.snippet?.authorDisplayName),

            languageCode: this.resolveStoredLanguageCode(input.language),

            likesCount: comment.snippet?.likeCount ?? 0,

            publishedAt: this.parseDate(comment.snippet?.publishedAt),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `YouTube comments collection failed for video ${videoId}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Filters low-value YouTube comments.
   */
  private isUsefulComment(
    comment: YouTubeTopLevelComment,
    input: CollectorInput,
  ): boolean {
    const rawContent = this.cleanPlainText(comment.snippet?.textDisplay);

    const content = this.cleanNormalizedText(rawContent);

    if (!comment.id || content.length < 50) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) {
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

    const lowValueComments = new Set([
      'thanks',
      'thank you',
      'great',
      'good',
      'nice',
      'awesome',
      'love it',
      'very good',
      'great video',
      'nice video',
      'good video',
    ]);

    if (lowValueComments.has(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Reads YouTube-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('YOUTUBE_BLOCKED_WORDS');
  }

  /**
   * Reads the YouTube API key.
   */
  private getApiKey(): string {
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'YouTube API key is missing. Please set YOUTUBE_API_KEY in environment variables.',
      );
    }

    return apiKey;
  }

  /**
   * Parses an external date safely.
   */
  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Parses non-negative API counters.
   */
  private toNonNegativeNumber(value?: string): number {
    const parsed = Number(value ?? 0);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
      : 'Unknown YouTube collector error.';
  }
}