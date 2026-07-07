import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

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
 * Collects public YouTube videos and top-level comments using
 * YouTube Data API v3.
 *
 * Uses shared utilities for:
 * - Region code resolution.
 * - Language code resolution and lightweight language matching.
 * - HTTP retry and cache support.
 * - Query enrichment.
 * - Relevance scoring.
 *
 * @author Malak
 */
@Injectable()
export class YouTubeCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.YOUTUBE;

  private readonly platformName = 'YouTube';
  private readonly apiBaseUrl = 'https://www.googleapis.com/youtube/v3';

  private readonly maxSearchQueries: number;

  constructor(configService: ConfigService) {
    super(configService, YouTubeCollector.name);

    this.maxSearchQueries = this.getPositiveNumber(
      'COLLECTOR_MAX_SEARCH_QUERIES',
      4,
    );
  }

  /**
   * Collects public YouTube videos and useful top-level comments.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const apiKey = this.getApiKey();

    const searchQueries = this.buildSearchQueries(input).slice(
      0,
      this.maxSearchQueries,
    );

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
        if (collectedPosts.length >= this.maxSavedPosts) break;

        const videos = await this.searchVideos(input, apiKey, query);

        const validVideos = videos
          .filter((video) => this.isValidVideo(video))
          .filter((video) => this.matchesInputContext(video, input));

        const videoIds = validVideos
          .map((video) => video.id?.videoId)
          .filter((videoId): videoId is string => Boolean(videoId));

        const statisticsMap = await this.fetchVideoStatistics(videoIds, apiKey);

        const rankedVideos = validVideos
          .map((video) => {
            const videoId = video.id?.videoId;

            return {
              video,
              score: this.calculateVideoRelevanceScore(
                video,
                input,
                videoId ? statisticsMap.get(videoId) : undefined,
              ),
            };
          })
          .filter((item) => item.score > 5)
          .sort((a, b) => b.score - a.score);

        for (const item of rankedVideos) {
          if (collectedPosts.length >= this.maxSavedPosts) break;

          const video = item.video;
          const videoId = video.id?.videoId;

          if (!videoId || seenVideoIds.has(videoId)) continue;

          seenVideoIds.add(videoId);

          collectedPosts.push(
            await this.mapVideoToCollectorPost(
              video,
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
   * Searches YouTube videos using a prepared search query.
   */
  private async searchVideos(
    input: CollectorInput,
    apiKey: string,
    query: string,
  ): Promise<YouTubeSearchVideo[]> {
    const cacheKey = CollectorCacheUtil.build('youtube', 'search', [
      query,
      input.country,
      input.language,
    ]);

    const data = await CollectorHttpUtil.getWithRetryAndCache<
      YouTubeSearchResponse
    >(
      `${this.apiBaseUrl}/search`,
      {
        params: this.buildSearchParams(input, apiKey, query),
        timeout: 10000,
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
   * Builds YouTube Data API search parameters.
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

    if (regionCode) params.regionCode = regionCode;
    if (relevanceLanguage) params.relevanceLanguage = relevanceLanguage;

    return params;
  }

  /**
   * Builds search queries from domain keywords, user keywords,
   * and problem-related generated queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    if (!domainKeywords.length) return [];

    const problemWords = this.getProblemWords();

    const problemQueries = CollectorQueryBuilderUtil.buildProblemQueries(
      domainKeywords,
      problemWords,
    );

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.normalizeQuery(keyword))
      .filter(Boolean);

    return this.unique([
      ...domainKeywords,
      ...userQueries,
      ...problemQueries,
    ]).filter(Boolean);
  }

  /**
   * Performs lightweight validation before mapping videos.
   */
  private isValidVideo(video: YouTubeSearchVideo): boolean {
    const videoId = video.id?.videoId;
    const title = video.snippet?.title ?? '';
    const description = video.snippet?.description ?? '';
    const channelTitle = video.snippet?.channelTitle ?? '';

    const content = this.normalizeText(
      `${title} ${description} ${channelTitle}`,
    );

    const blockedWords = this.getBlockedWords();

    return (
      Boolean(videoId) &&
      Boolean(title) &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  /**
   * Checks whether the video matches requested language/context.
   */
  private matchesInputContext(
    video: YouTubeSearchVideo,
    input: CollectorInput,
  ): boolean {
    const title = video.snippet?.title ?? '';
    const description = video.snippet?.description ?? '';
    const content = this.normalizeText(`${title} ${description}`);

    return CollectorLanguageUtil.matchesRequestedLanguage(
      content,
      input.language,
    );
  }

  /**
   * Calculates a lightweight relevance score for a YouTube video.
   */
  private calculateVideoRelevanceScore(
    video: YouTubeSearchVideo,
    input: CollectorInput,
    statistics?: YouTubeVideoStatistics,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: video.snippet?.title ?? '',
      body: video.snippet?.description ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: statistics?.likeCount ?? 0,
      replies: statistics?.commentCount ?? 0,
      publishedAt: video.snippet?.publishedAt
        ? new Date(video.snippet.publishedAt)
        : undefined,
    });
  }

  /**
   * Maps a YouTube video into the common CollectorPost format.
   */
  private async mapVideoToCollectorPost(
    video: YouTubeSearchVideo,
    input: CollectorInput,
    statistics?: YouTubeVideoStatistics,
  ): Promise<CollectorPost> {
    const videoId = video.id?.videoId ?? '';
    const snippet = video.snippet ?? {};

    const comments = await this.collectVideoComments(videoId, input);

    return {
      sourceType: CollectionSourceType.YOUTUBE,
      platformName: this.platformName,
      externalId: videoId,
      title: snippet.title,
      content: snippet.description || snippet.title || '',
      author: snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${videoId}`,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: statistics?.likeCount ?? 0,
      repliesCount: statistics?.commentCount ?? comments.length,
      publishedAt: snippet.publishedAt
        ? new Date(snippet.publishedAt)
        : undefined,
      comments,
    };
  }

  /**
   * Fetches like and comment statistics for selected videos.
   */
  private async fetchVideoStatistics(
    videoIds: string[],
    apiKey: string,
  ): Promise<Map<string, YouTubeVideoStatistics>> {
    const statisticsMap = new Map<string, YouTubeVideoStatistics>();

    if (!videoIds.length) return statisticsMap;

    try {
      const cacheKey = CollectorCacheUtil.build('youtube', 'statistics', [
        videoIds.join(','),
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<
        YouTubeStatisticsResponse
      >(
        `${this.apiBaseUrl}/videos`,
        {
          params: {
            key: apiKey,
            part: 'statistics',
            id: videoIds.join(','),
          },
          timeout: 10000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const videos = data.items ?? [];

      videos.forEach((video) => {
        if (!video.id) return;

        statisticsMap.set(video.id, {
          likeCount: Number(video.statistics?.likeCount ?? 0),
          commentCount: Number(video.statistics?.commentCount ?? 0),
        });
      });

      return statisticsMap;
    } catch {
      return statisticsMap;
    }
  }

  /**
   * Collects useful top-level comments for a YouTube video.
   */
  private async collectVideoComments(
    videoId: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!videoId) return [];

    const apiKey = this.getApiKey();

    try {
      const cacheKey = CollectorCacheUtil.build('youtube', 'comments', [
        videoId,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<
        YouTubeCommentsResponse
      >(
        `${this.apiBaseUrl}/commentThreads`,
        {
          params: {
            key: apiKey,
            part: 'snippet',
            videoId,
            maxResults: Math.min(this.maxFetchedComments, 100),
            order: 'relevance',
            textFormat: 'plainText',
          },
          timeout: 10000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const comments = data.items ?? [];
      const seenCommentIds = new Set<string>();

      return comments
        .map((item) => item.snippet?.topLevelComment)
        .filter((comment): comment is YouTubeTopLevelComment =>
          Boolean(comment),
        )
        .filter((comment) => this.isUsefulComment(comment, input))
        .filter((comment) => {
          const id = comment.id;

          if (!id || seenCommentIds.has(id)) return false;

          seenCommentIds.add(id);
          return true;
        })
        .sort(
          (a, b) =>
            (b.snippet?.likeCount ?? 0) - (a.snippet?.likeCount ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map((comment): CollectorComment => {
          const snippet = comment.snippet ?? {};

          return {
            externalId: comment.id ?? '',
            content: snippet.textDisplay ?? '',
            author: snippet.authorDisplayName,
            likesCount: snippet.likeCount ?? 0,
            publishedAt: snippet.publishedAt
              ? new Date(snippet.publishedAt)
              : undefined,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Filters YouTube comments before storage.
   */
  private isUsefulComment(
    comment: YouTubeTopLevelComment,
    input: CollectorInput,
  ): boolean {
    const rawContent = comment.snippet?.textDisplay ?? '';
    const content = this.normalizeText(rawContent);

    if (!comment.id || content.length < 50) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    if (
      !CollectorLanguageUtil.matchesRequestedLanguage(content, input.language)
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

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Reads common blocked words and YouTube-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('YOUTUBE_BLOCKED_WORDS');
  }

  /**
   * Normalizes a YouTube search query.
   */
  private normalizeQuery(query: string): string {
    return this.normalizeText(query);
  }

  /**
   * Reads a positive numeric configuration value.
   */
  protected getPositiveNumber(key: string, defaultValue: number): number {
    const value = Number(this.configService.get(key));

    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }

  /**
   * Reads YouTube API key from environment variables.
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
   * Extracts readable message from unknown errors.
   */
  private getErrorMessage(error: unknown): unknown {
    if (error instanceof Error) {
      return error.message;
    }

    return error;
  }
}