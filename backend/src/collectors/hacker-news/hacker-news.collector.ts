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
 * Collects public Hacker News stories and top-level comments using
 * the official Hacker News Firebase API.
 *
 * This collector is useful for technical domains such as:
 * - Artificial Intelligence.
 * - Software Engineering.
 * - Cybersecurity.
 * - Developer tools.
 * - Startups and technology trends.
 *
 * Notes:
 * - Hacker News does not support country, city, or radius filtering.
 * - Location fields are therefore stored as null on posts.
 * - The request location remains available on the CollectionJob itself.
 * - Hacker News stories often contain only a title and URL, so comments
 *   are especially important for NLP analysis.
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
   * Collects Hacker News stories, ranks them by relevance,
   * attaches useful comments, and maps them to CollectorPost.
   *
   * @param input Collection request input.
   * @returns Relevant Hacker News posts with useful comments.
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
      const stories = await this.collectCandidateStories(storyIds);

      const rankedStories = stories
        .map((story) => ({
          story,
          score: this.calculateFinalStoryScore(story, input, searchTerms),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      const posts: CollectorPost[] = [];

      for (const item of rankedStories) {
        if (posts.length >= this.maxSavedPosts) {
          break;
        }

        const post = await this.mapStoryToCollectorPost(item.story, input);

        if (!post.comments.length) {
          continue;
        }

        posts.push(post);
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
   *
   * Combining several feeds gives better coverage than depending only
   * on topstories, because relevant AI or developer discussions may appear
   * in Ask HN, Show HN, Best, or New.
   *
   * @returns Deduplicated story IDs.
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
   * Fetches and validates candidate stories before scoring.
   *
   * This method intentionally limits the number of inspected stories to avoid
   * excessive API calls while still giving the ranking algorithm enough data.
   *
   * @param storyIds Candidate story IDs from Hacker News feeds.
   * @returns Valid unique Hacker News stories.
   */
  private async collectCandidateStories(
    storyIds: number[],
  ): Promise<HackerNewsItem[]> {
    const stories: HackerNewsItem[] = [];
    const seenStoryIds = new Set<string>();

    for (const storyId of storyIds.slice(0, this.maxFetchedPosts * 8)) {
      if (stories.length >= this.maxFetchedPosts * 10) {
        break;
      }

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

    return stories;
  }

  /**
   * Fetches a single Hacker News item by ID.
   *
   * Hacker News uses the same item endpoint for stories and comments.
   *
   * @param id Hacker News item ID.
   * @returns Hacker News item or null if the request fails.
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
   *
   * User keywords are placed first because they represent the most explicit
   * intent from the collection request.
   *
   * @param input Collection request input.
   * @returns Deduplicated normalized search terms.
   */
  private buildSearchTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
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
   * Validates Hacker News stories before ranking.
   *
   * Deleted, dead, empty, or blocked stories are ignored.
   *
   * @param story Raw Hacker News story.
   * @returns True when the story can be scored.
   */
  private isValidStory(story: HackerNewsItem | null): story is HackerNewsItem {
    if (!story?.id || story.type !== 'story' || !story.title) {
      return false;
    }

    if (story.deleted || story.dead) {
      return false;
    }

    const title = this.cleanPlainText(story.title);
    const text = this.cleanPlainText(story.text);
    const url = story.url ?? `${this.siteBaseUrl}/item?id=${story.id}`;
    const content = this.cleanNormalizedText(`${title} ${text}`);
    const blockedWords = this.getBlockedWords();

    if (!url || content.length < 10) {
      return false;
    }

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates final story score.
   *
   * Stories that do not match the domain/user search terms are ignored.
   *
   * @param story Hacker News story.
   * @param input Collection input.
   * @param searchTerms Terms used to identify relevant stories.
   * @returns Final relevance score.
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
   *
   * Engagement and recency are included through RelevanceScoreUtil.
   *
   * @param story Hacker News story.
   * @param input Collection input.
   * @returns Base relevance score.
   */
  private calculateStoryRelevanceScore(
    story: HackerNewsItem,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(story.title),
      body: this.cleanPlainText(story.text),
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: story.score ?? 0,
      replies: story.descendants ?? 0,
      publishedAt: story.time ? new Date(story.time * 1000) : undefined,
    });
  }

  /**
   * Adds score when search terms appear in title, body, or URL.
   *
   * Title matches are weighted highest because HN stories often use
   * concise titles that represent the main discussion topic.
   *
   * @param story Hacker News story.
   * @param searchTerms Normalized search terms.
   * @returns Keyword relevance bonus.
   */
  private calculateKeywordBonus(
    story: HackerNewsItem,
    searchTerms: string[],
  ): number {
    const title = this.cleanNormalizedText(story.title);
    const body = this.cleanNormalizedText(story.text);
    const url = this.cleanNormalizedText(story.url);
    const content = `${title} ${body} ${url}`;

    let bonus = 0;

    for (const term of searchTerms) {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|\\W)${escapedTerm}(\\W|$)`, 'i');

      if (pattern.test(title)) bonus += 40;
      if (pattern.test(body)) bonus += 20;
      if (pattern.test(url)) bonus += 10;
      if (pattern.test(content)) bonus += 5;
    }

    return bonus;
  }

  /**
   * Adds score for Hacker News terms that often indicate problems,
   * needs, feature requests, developer pain points, or technical friction.
   *
   * @param story Hacker News story.
   * @returns Problem/need relevance bonus.
   */
  private calculateProblemBonus(story: HackerNewsItem): number {
    const title = this.cleanNormalizedText(story.title);
    const body = this.cleanNormalizedText(story.text);
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
      'token',
      'cost',
      'latency',
      'privacy',
      'security',
      'offline',
      'local',
    ];

    let bonus = 0;

    for (const term of hnProblemTerms) {
      if (content.includes(term)) {
        bonus += 6;
      }
    }

    return bonus;
  }

  /**
   * Maps Hacker News story to the unified CollectorPost format.
   *
   * Location fields are stored as null because Hacker News does not
   * provide country/city/region filtering or user location metadata.
   *
   * @param story Hacker News story.
   * @param input Collection input.
   * @returns CollectorPost with useful comments.
   */
  private async mapStoryToCollectorPost(
    story: HackerNewsItem,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectStoryComments(story);

    const title = this.cleanPlainText(story.title);
    const content = this.cleanPlainText(story.text ?? story.title);
    const author = this.cleanPlainText(story.by);

    return {
      sourceType: CollectionSourceType.HACKER_NEWS,
      platformName: this.platformName,
      externalId: story.id?.toString() ?? '',
      title,
      content: content || title,
      author,
      url: story.url ?? `${this.siteBaseUrl}/item?id=${story.id}`,

      country: undefined,
      city: undefined,
      region: undefined,

      language: input.language,
      likesCount: story.score ?? 0,
      repliesCount: story.descendants ?? comments.length,
      publishedAt: story.time ? new Date(story.time * 1000) : undefined,
      comments,
    };
  }

  /**
   * Collects useful top-level comments for a Hacker News story.
   *
   * Hacker News comment trees can be deeply nested. This collector currently
   * collects only direct child comments to keep collection predictable and fast.
   *
   * @param story Hacker News story.
   * @returns Useful comments for NLP analysis.
   */
  private async collectStoryComments(
    story: HackerNewsItem,
  ): Promise<CollectorComment[]> {
    const commentIds = (story.kids ?? []).slice(0, this.maxFetchedComments);
    const comments: CollectorComment[] = [];
    const seenCommentIds = new Set<string>();

    for (const commentId of commentIds) {
      if (comments.length >= this.maxSavedComments) {
        break;
      }

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
        content: this.cleanPlainText(comment.text),
        author: this.cleanPlainText(comment.by),
        language: undefined,
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
   *
   * Filters deleted/dead comments, short comments, low-value comments,
   * and comments containing blocked terms.
   *
   * @param comment Raw Hacker News comment.
   * @returns True when the comment is useful for NLP.
   */
  private isUsefulComment(
    comment: HackerNewsItem | null,
  ): comment is HackerNewsItem {
    if (!comment?.id || comment.type !== 'comment' || comment.deleted) {
      return false;
    }

    const content = this.cleanNormalizedText(comment.text);

    if (comment.dead || content.length < 40) {
      return false;
    }

    if (this.isLowValueComment(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Detects comments that are too generic to help idea discovery.
   *
   * @param content Normalized comment content.
   * @returns True if the comment is low-value.
   */
  private isLowValueComment(content: string): boolean {
    const lowValuePatterns = [
      /^thanks$/i,
      /^thank you$/i,
      /^great$/i,
      /^nice$/i,
      /^cool$/i,
      /^awesome$/i,
      /^lol$/i,
      /^same$/i,
      /^me too$/i,
      /^i agree$/i,
      /^\+1$/i,
      /\bthis\b.{0,10}\bworks\b/i,
      /\bbookmarked\b/i,
      /\binteresting\b/i,
      /\bwell done\b/i,
    ];

    return lowValuePatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Reads common blocked words and Hacker News-specific blocked words.
   *
   * @returns Merged blocked words list.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('HACKER_NEWS_BLOCKED_WORDS');
  }

  /**
   * Builds Hacker News API headers.
   *
   * @returns JSON HTTP headers.
   */
  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
  }

  /**
   * Extracts a readable message from unknown errors.
   *
   * @param error Unknown caught error.
   * @returns Error message or original error value.
   */
  private getErrorMessage(error: unknown): unknown {
    if (error instanceof Error) {
      return error.message;
    }

    return error;
  }
}