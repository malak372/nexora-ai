import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

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
  implements SocialCollector {
  readonly sourceType = CollectionSourceType.HACKER_NEWS;

  private readonly platformName = 'Hacker News';
  private readonly apiBaseUrl = 'https://hacker-news.firebaseio.com/v0';
  private readonly siteBaseUrl = 'https://news.ycombinator.com';

  constructor(configService: ConfigService) {
    super(configService, HackerNewsCollector.name);
  }

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
      const stories: any[] = [];
      const seenStoryIds = new Set<string>();

      for (const storyId of storyIds.slice(0, this.maxFetchedPosts * 8)) {
        if (stories.length >= this.maxFetchedPosts * 10) break;

        const story = await this.getItem(storyId);

        if (!this.isValidStory(story)) {
          continue;
        }

        const id = story.id.toString();

        if (seenStoryIds.has(id)) {
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
    } catch (error: any) {
      this.logger.error(
        'Hacker News collection failed',
        error.response?.data ?? error.message,
      );

      throw new ServiceUnavailableException(
        'Hacker News collection failed. Check collector limits, API availability, or network connection.',
      );
    }
  }

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

  private async getItem(id: number): Promise<any | null> {
    try {
      const cacheKey = CollectorCacheUtil.build('hacker-news', 'item', [id]);

      return await CollectorHttpUtil.getWithRetryAndCache<any>(
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

  private isValidStory(story: any): boolean {
    if (!story?.id || story?.type !== 'story' || !story?.title) {
      return false;
    }

    if (story?.deleted || story?.dead) {
      return false;
    }

    const title = this.normalizeText(story.title);
    const text = this.normalizeText(story?.text ?? '');
    const url = story?.url ?? `${this.siteBaseUrl}/item?id=${story.id}`;
    const content = `${title} ${text}`;
    const blockedWords = this.getBlockedWords();

    if (!url || content.length < 10) {
      return false;
    }

    return !blockedWords.some((word) => content.includes(word));
  }

  private calculateFinalStoryScore(
    story: any,
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

  private calculateStoryRelevanceScore(
    story: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: story?.title ?? '',
      body: story?.text ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: story?.score ?? 0,
      replies: story?.descendants ?? 0,
      publishedAt: story?.time ? new Date(story.time * 1000) : undefined,
    });
  }

  private calculateKeywordBonus(story: any, searchTerms: string[]): number {
    const title = this.normalizeText(story?.title ?? '');
    const body = this.normalizeText(story?.text ?? '');
    const url = this.normalizeText(story?.url ?? '');
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
  private calculateProblemBonus(story: any): number {
    const title = this.normalizeText(story?.title ?? '');
    const body = this.normalizeText(story?.text ?? '');
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

  private async mapStoryToCollectorPost(
    story: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectStoryComments(story);

    return {
      sourceType: CollectionSourceType.HACKER_NEWS,
      platformName: this.platformName,
      externalId: story.id.toString(),
      title: story.title,
      content: this.stripHtml(story.text ?? story.title),
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

  private async collectStoryComments(story: any): Promise<CollectorComment[]> {
    const commentIds = (story?.kids ?? []).slice(0, this.maxFetchedComments);
    const comments: CollectorComment[] = [];
    const seenCommentIds = new Set<string>();

    for (const commentId of commentIds) {
      if (comments.length >= this.maxSavedComments) break;

      const comment = await this.getItem(commentId);

      if (!this.isUsefulComment(comment)) {
        continue;
      }

      const id = comment.id.toString();

      if (seenCommentIds.has(id)) {
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

  private isUsefulComment(comment: any): boolean {
    const content = this.normalizeText(this.stripHtml(comment?.text ?? ''));

    if (!comment?.id || comment?.type !== 'comment' || comment?.deleted) {
      return false;
    }

    if (comment?.dead || content.length < 40) {
      return false;
    }

    if (this.isLowValueComment(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

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

  protected getBlockedWords(): string[] {
    return super.getBlockedWords('HACKER_NEWS_BLOCKED_WORDS');
  }

  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
  }
}