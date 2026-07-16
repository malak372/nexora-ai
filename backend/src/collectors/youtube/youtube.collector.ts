import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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
export class YouTubeCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'youtube';

  private readonly apiBaseUrl =
    'https://www.googleapis.com/youtube/v3';

  private readonly maxSearchQueries: number;

  constructor(configService: ConfigService) {
    super(configService, YouTubeCollector.name);

    this.maxSearchQueries = this.getPositiveNumber(
      'COLLECTOR_MAX_SEARCH_QUERIES',
      4,
    );
  }

  /**
   * Collects public YouTube videos and comments.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const apiKey = this.getApiKey();

    const searchQueries = this.buildSearchQueries(input)
      .slice(0, this.maxSearchQueries);

    if (!searchQueries.length) {
      this.logger.warn(
        'YouTube collection skipped because no domain keywords exist.',
      );

      return [];
    }

    const collectedPosts: CollectorPost[] = [];
    const seenVideoIds = new Set<string>();

    try {
      for (const query of searchQueries) {
        if (
          collectedPosts.length >=
          this.maxSavedPosts
        ) {
          break;
        }

        const videos = await this.searchVideos(
          input,
          apiKey,
          query,
        );

        const validVideos = videos
          .filter((video) => this.isValidVideo(video))
          .filter((video) =>
            this.matchesInputContext(video, input),
          );

        const videoIds = validVideos
          .map((video) => video.id?.videoId)
          .filter(
            (videoId): videoId is string =>
              Boolean(videoId),
          );

        const statisticsMap =
          await this.fetchVideoStatistics(
            videoIds,
            apiKey,
          );

        const rankedVideos = validVideos
          .map((video) => {
            const videoId = video.id?.videoId;

            return {
              video,

              score: this.calculateVideoRelevanceScore(
                video,
                input,
                videoId
                  ? statisticsMap.get(videoId)
                  : undefined,
              ),
            };
          })
          .filter((item) => item.score > 5)
          .sort(
            (first, second) =>
              second.score - first.score,
          );

        for (const item of rankedVideos) {
          if (
            collectedPosts.length >=
            this.maxSavedPosts
          ) {
            break;
          }

          const videoId =
            item.video.id?.videoId;

          if (
            !videoId ||
            seenVideoIds.has(videoId)
          ) {
            continue;
          }

          seenVideoIds.add(videoId);

          collectedPosts.push(
            await this.mapVideoToCollectorPost(
              item.video,
              input,
              statisticsMap.get(videoId),
            ),
          );
        }
      }

      this.logger.log(
        `YouTube collection completed. Posts: ${collectedPosts.length}`,
      );

      return collectedPosts;
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
    const cacheKey = CollectorCacheUtil.build(
      this.sourceKey,
      'search',
      [
        query,
        input.country,
        input.language,
      ],
    );

    const data =
      await CollectorHttpUtil.getWithRetryAndCache<YouTubeSearchResponse>(
        `${this.apiBaseUrl}/search`,
        {
          params: this.buildSearchParams(
            input,
            apiKey,
            query,
          ),
          timeout: 10_000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

    return data.items ?? [];
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

    const regionCode =
      CollectorRegionUtil.resolveRegionCode(
        input.country,
      );

    const relevanceLanguage =
      CollectorLanguageUtil.resolveLanguageCode(
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
    const domainKeywords = this.getDomainKeywords(input);

    if (!domainKeywords.length) {
      return [];
    }

    const problemQueries =
      CollectorQueryBuilderUtil.buildProblemQueries(
        domainKeywords,
        this.getProblemWords(),
      );

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    return this.unique([
      ...domainKeywords,
      ...userQueries,
      ...problemQueries,
    ]).filter(Boolean);
  }

  /**
   * Validates one search result.
   */
  private isValidVideo(video: YouTubeSearchVideo): boolean {
    const videoId = video.id?.videoId;

    const title = this.cleanPlainText(
      video.snippet?.title,
    );

    const description = this.cleanPlainText(
      video.snippet?.description,
    );

    const channelTitle = this.cleanPlainText(
      video.snippet?.channelTitle,
    );

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
      `${video.snippet?.title ?? ''} ${
        video.snippet?.description ?? ''
      }`,
    );

    return CollectorLanguageUtil.matchesRequestedLanguage(
      content,
      input.language,
    );
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

      body: this.cleanPlainText(
        video.snippet?.description,
      ),

      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),

      likes: statistics?.likeCount ?? 0,
      replies: statistics?.commentCount ?? 0,

      publishedAt: this.parseDate(
        video.snippet?.publishedAt,
      ),
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
    const description = this.cleanPlainText(
      snippet.description,
    );

    const comments = await this.collectVideoComments(
      videoId,
      input,
    );

    return {
      externalId: videoId,
      title,
      content: description || title,

      author: this.cleanPlainText(
        snippet.channelTitle,
      ),

      url: `https://www.youtube.com/watch?v=${videoId}`,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(
        input.language,
      ),

      likesCount: statistics?.likeCount ?? 0,

      repliesCount:
        statistics?.commentCount ??
        comments.length,

      publishedAt: this.parseDate(
        snippet.publishedAt,
      ),

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
    const statisticsMap =
      new Map<string, YouTubeVideoStatistics>();

    if (!videoIds.length) {
      return statisticsMap;
    }

    try {
      const cacheKey = CollectorCacheUtil.build(
        this.sourceKey,
        'statistics',
        [videoIds.join(',')],
      );

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
          likeCount: this.toNonNegativeNumber(
            video.statistics?.likeCount,
          ),

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
      const cacheKey = CollectorCacheUtil.build(
        this.sourceKey,
        'comments',
        [videoId],
      );

      const data =
        await CollectorHttpUtil.getWithRetryAndCache<YouTubeCommentsResponse>(
          `${this.apiBaseUrl}/commentThreads`,
          {
            params: {
              key: this.getApiKey(),
              part: 'snippet',
              videoId,
              maxResults: Math.min(
                this.maxFetchedComments,
                100,
              ),
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
        .map(
          (item) =>
            item.snippet?.topLevelComment,
        )
        .filter(
          (
            comment,
          ): comment is YouTubeTopLevelComment =>
            Boolean(comment),
        )
        .filter((comment) =>
          this.isUsefulComment(comment, input),
        )
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
            (second.snippet?.likeCount ?? 0) -
            (first.snippet?.likeCount ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: comment.id ?? '',

            content: this.cleanPlainText(
              comment.snippet?.textDisplay,
            ),

            author: this.cleanPlainText(
              comment.snippet?.authorDisplayName,
            ),

            languageCode: this.resolveStoredLanguageCode(
              input.language,
            ),

            likesCount:
              comment.snippet?.likeCount ?? 0,

            publishedAt: this.parseDate(
              comment.snippet?.publishedAt,
            ),
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
    const rawContent = this.cleanPlainText(
      comment.snippet?.textDisplay,
    );

    const content = this.cleanNormalizedText(rawContent);

    if (!comment.id || content.length < 50) {
      return false;
    }

    const cleaned = content
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();

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
    const apiKey =
      this.configService.get<string>(
        'YOUTUBE_API_KEY',
      );

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
  private toNonNegativeNumber(
    value?: string,
  ): number {
    const parsed = Number(value ?? 0);

    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : 0;
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