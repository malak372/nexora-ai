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
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

type HackerNewsItem = {
  id?: number;
  type?: 'story' | 'comment' | string;
  title?: string;
  text?: string;
  url?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
};

/**
 * Hacker News collector.
 *
 * Collects public Hacker News stories and comments using the official
 * Hacker News Firebase API.
 *
 * Supports:
 * - Multiple Hacker News feeds.
 * - Domain-based ranking.
 * - Optional user keywords.
 * - Useful comments collection.
 * - Lightweight relevance scoring.
 * - Deduplication.
 * - Retry with exponential backoff.
 * - In-memory caching.
 *
 * Notes:
 * - Hacker News does not provide real country/city filtering.
 * - country/city/region/language are stored as request metadata only.
 *
 * @author Malak
 */
@Injectable()
export class HackerNewsCollector
  extends BaseCollector
  implements SocialCollector
{
  readonly sourceType = CollectionSourceType.HACKER_NEWS;

  private readonly platformName = 'Hacker News';
  private readonly apiBaseUrl = 'https://hacker-news.firebaseio.com/v0';
  private readonly siteBaseUrl = 'https://news.ycombinator.com';

  constructor(configService: ConfigService) {
    super(configService, HackerNewsCollector.name);
  }

  /**
   * Collects Hacker News stories, ranks them, and maps them
   * into the unified CollectorPost format.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchTerms = this.buildSearchTerms(input);

      if (!searchTerms.length) {
        this.logger.warn(
          'Hacker News collection skipped because no search keywords exist.',
        );
        return [];
      }

      const storyIds = await this.getStoryIds();
      const stories: HackerNewsItem[] = [];
      const seenStoryIds = new Set<string>();

      for (const storyId of storyIds.slice(0, this.maxFetchedPosts * 8)) {
        if (stories.length >= this.maxFetchedPosts * 10) break;

        const story = await this.getItem(storyId);

        if (!this.isValidStory(story)) {
          continue;
        }

        const id = story.id?.toString();

        if (!id || seenStoryIds.has(id)) {
          continue;
        }

        seenStoryIds.add(id);
        stories.push(story);
      }

      const rankedStories = stories
        .map((story) => ({
          story,
          score: this.calculateFinalStoryScore(story, input, searchTerms),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts: CollectorPost[] = [];

      for (const item of rankedStories) {
        posts.push(await this.mapStoryToCollectorPost(item.story, input));
      }

      this.logger.log(
        `Hacker News collection completed. Posts: ${posts.length}`,
      );

      return posts;
    } catch (error: unknown) {
      this.logger.error(
        'Hacker News collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'Hacker News collection failed. Check collector limits, API availability, or network connection.',
      );
    }
  }

  /**
   * Collects story IDs from multiple Hacker News feeds.
   */
  private async getStoryIds(): Promise<number[]> {
    const feeds = [
      'topstories',
      'newstories',
      'askstories',
      'showstories',
      'beststories',
    ];

    const allIds: number[] = [];

    for (const feed of feeds) {
      const cacheKey = CollectorCacheUtil.build('hacker-news', 'story-ids', [
        feed,
      ]);

      const ids = await CollectorHttpUtil.getWithRetryAndCache<number[]>(
        `${this.apiBaseUrl}/${feed}.json`,
        {
          headers: this.buildHeaders(),
          timeout: 10000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      allIds.push(...(ids ?? []));
    }

    return this.unique(allIds);
  }

  /**
   * Fetches a single Hacker News item by ID.
   */
  private async getItem(id: number): Promise<HackerNewsItem | null> {
    try {
      const cacheKey = CollectorCacheUtil.build('hacker-news', 'item', [id]);

      return await CollectorHttpUtil.getWithRetryAndCache<HackerNewsItem>(
        `${this.apiBaseUrl}/item/${id}.json`,
        {
          headers: this.buildHeaders(),
          timeout: 10000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );
    } catch {
      return null;
    }
  }

  /**
   * Builds search terms from user keywords, domain keywords, and domain name.
   */
  private buildSearchTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ])
      .filter((term) => term.length >= 2)
      .slice(0, 8);
  }

  /**
   * Validates Hacker News story before ranking.
   */
  private isValidStory(story: HackerNewsItem | null): story is HackerNewsItem {
    if (!story?.id || story.type !== 'story' || !story.title) {
      return false;
    }

    if (story.deleted || story.dead) {
      return false;
    }

    const title = this.normalizeText(story.title);
    const text = this.normalizeText(story.text ?? '');
    const url = story.url ?? `${this.siteBaseUrl}/item?id=${story.id}`;
    const content = `${title} ${text}`;
    const blockedWords = this.getBlockedWords();

    if (!url || content.length < 10) {
      return false;
    }

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Calculates final story score.
   *
   * If the story does not match any search term, it is ignored.
   */
  private calculateFinalStoryScore(
    story: HackerNewsItem,
    input: CollectorInput,
    searchTerms: string[],
  ): number {
    const keywordBonus = this.calculateKeywordBonus(story, searchTerms);

    if (keywordBonus <= 0) {
      return 0;
    }

    const baseScore = this.calculateStoryRelevanceScore(story, input);
    const problemBonus = this.calculateProblemBonus(story);

    return baseScore + keywordBonus + problemBonus;
  }

  /**
   * Calculates base relevance score using the shared scoring utility.
   */
  private calculateStoryRelevanceScore(
    story: HackerNewsItem,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: story.title ?? '',
      body: story.text ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: story.score ?? 0,
      replies: story.descendants ?? 0,
      publishedAt: story.time ? new Date(story.time * 1000) : undefined,
    });
  }

  /**
   * Adds score when search terms appear in title, body, or URL.
   */
  private calculateKeywordBonus(
    story: HackerNewsItem,
    searchTerms: string[],
  ): number {
    const title = this.normalizeText(story.title ?? '');
    const body = this.normalizeText(story.text ?? '');
    const url = this.normalizeText(story.url ?? '');
    const content = `${title} ${body} ${url}`;

    let bonus = 0;

    for (const term of searchTerms) {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|\\W)${escapedTerm}(\\W|$)`, 'i');

      if (pattern.test(title)) bonus += 40;
      if (pattern.test(body)) bonus += 20;
      if (pattern.test(url)) bonus += 10;
    }

    return bonus;
  }

  /**
   * Adds score for Hacker News terms that often indicate problems or needs.
   */
  private calculateProblemBonus(story: HackerNewsItem): number {
    const title = this.normalizeText(story.title ?? '');
    const body = this.normalizeText(story.text ?? '');
    const content = `${title} ${body}`;

    const hnProblemTerms = [
      'ask hn',
      'show hn',
      'problem',
      'issue',
      'pain',
      'missing',
      'need',
      'needs',
      'wish',
      'difficult',
      'hard',
      'broken',
      'fails',
      'failure',
      'bug',
      'limitation',
      'alternative',
      'tool',
      'workflow',
      'developer',
      'api',
      'agent',
      'ai',
      'llm',
    ];

    let bonus = 0;

    for (const term of hnProblemTerms) {
      if (content.includes(term)) bonus += 6;
    }

    return bonus;
  }

  /**
   * Maps Hacker News story to the unified CollectorPost format.
   */
  private async mapStoryToCollectorPost(
    story: HackerNewsItem,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectStoryComments(story);

    return {
      sourceType: CollectionSourceType.HACKER_NEWS,
      platformName: this.platformName,
      externalId: story.id?.toString() ?? '',
      title: story.title,
      content: this.stripHtml(story.text ?? story.title ?? ''),
      author: story.by,
      url: story.url ?? `${this.siteBaseUrl}/item?id=${story.id}`,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: story.score ?? 0,
      repliesCount: story.descendants ?? comments.length,
      publishedAt: story.time ? new Date(story.time * 1000) : undefined,
      comments,
    };
  }

  /**
   * Collects useful comments for a Hacker News story.
   */
  private async collectStoryComments(
    story: HackerNewsItem,
  ): Promise<CollectorComment[]> {
    const commentIds = (story.kids ?? []).slice(0, this.maxFetchedComments);
    const comments: CollectorComment[] = [];
    const seenCommentIds = new Set<string>();

    for (const commentId of commentIds) {
      if (comments.length >= this.maxSavedComments) break;

      const comment = await this.getItem(commentId);

      if (!this.isUsefulComment(comment)) {
        continue;
      }

      const id = comment.id?.toString();

      if (!id || seenCommentIds.has(id)) {
        continue;
      }

      seenCommentIds.add(id);

      comments.push({
        externalId: id,
        content: this.stripHtml(comment.text ?? ''),
        author: comment.by,
        likesCount: 0,
        publishedAt: comment.time
          ? new Date(comment.time * 1000)
          : undefined,
      });
    }

    return comments;
  }

  /**
   * Validates Hacker News comments before saving.
   */
  private isUsefulComment(
    comment: HackerNewsItem | null,
  ): comment is HackerNewsItem {
    const content = this.normalizeText(this.stripHtml(comment?.text ?? ''));

    if (!comment?.id || comment.type !== 'comment' || comment.deleted) {
      return false;
    }

    if (comment.dead || content.length < 40) {
      return false;
    }

    if (this.isLowValueComment(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Detects comments that are too generic to help idea discovery.
   */
  private isLowValueComment(content: string): boolean {
    const lowValuePatterns = [
      /^thanks$/i,
      /^thank you$/i,
      /^great$/i,
      /^nice$/i,
      /^\+1$/i,
      /\bthis\b.{0,10}\bworks\b/i,
      /\bbookmarked\b/i,
      /\binteresting\b/i,
    ];

    return lowValuePatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Reads common blocked words and Hacker News-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('HACKER_NEWS_BLOCKED_WORDS');
  }

  /**
   * Builds Hacker News API headers.
   */
  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
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