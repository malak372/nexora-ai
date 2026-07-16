import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { SocialCollector } from '../base/collector.interface';

import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Represents a Hacker News item returned by
 * the official Firebase API.
 *
 * Hacker News uses the same structure for
 * stories and comments.
 */
type HackerNewsItem = {
  id?: number;
  type?: string;
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
 * Collects public Hacker News stories and top-level comments.
 *
 * The sourceKey must match DataSource.key in the database.
 *
 * Hacker News does not expose geographical filtering,
 * so location fields remain undefined on collected posts.
 *
 * @author Malak
 */
@Injectable()
export class HackerNewsCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Stable collector registry key.
   *
   * Must match:
   * DataSource.key = "hacker-news"
   */
  readonly sourceKey = 'hacker-news';

  /**
   * Official Hacker News Firebase API.
   */
  private readonly apiBaseUrl = 'https://hacker-news.firebaseio.com/v0';

  /**
   * Public Hacker News site URL.
   */
  private readonly siteBaseUrl = 'https://news.ycombinator.com';

  constructor(configService: ConfigService) {
    super(configService, HackerNewsCollector.name);
  }

  /**
   * Collects Hacker News stories, ranks them,
   * attaches useful comments, and maps them.
   *
   * @param input Collection request input.
   * @returns Relevant Hacker News posts.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchTerms = this.buildSearchTerms(input);

      if (searchTerms.length === 0) {
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
        .sort((first, second) => second.score - first.score);

      const posts: CollectorPost[] = [];

      for (const item of rankedStories) {
        if (posts.length >= this.maxSavedPosts) {
          break;
        }

        const post = await this.mapStoryToCollectorPost(item.story, input);

        /*
         * Hacker News comments are important because many
         * stories contain only a title and URL.
         */
        if (post.comments.length === 0) {
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
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'story-ids', [
        feed,
      ]);

      const ids = await CollectorHttpUtil.getWithRetryAndCache<number[]>(
        `${this.apiBaseUrl}/${feed}.json`,
        {
          headers: this.buildHeaders(),

          timeout: 10_000,
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
   * Fetches and validates candidate stories.
   *
   * @param storyIds Story identifiers.
   * @returns Valid unique stories.
   */
  private async collectCandidateStories(
    storyIds: number[],
  ): Promise<HackerNewsItem[]> {
    const stories: HackerNewsItem[] = [];

    const seenStoryIds = new Set<string>();

    const candidateLimit = this.maxFetchedPosts * 8;

    for (const storyId of storyIds.slice(0, candidateLimit)) {
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
   * Fetches one Hacker News item.
   *
   * @param id Hacker News item identifier.
   * @returns Item or null when the request fails.
   */
  private async getItem(id: number): Promise<HackerNewsItem | null> {
    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'item', [id]);

      return await CollectorHttpUtil.getWithRetryAndCache<HackerNewsItem>(
        `${this.apiBaseUrl}/item/${id}.json`,
        {
          headers: this.buildHeaders(),

          timeout: 10_000,
        },
        {
          cacheKey,

          cacheTtlMs: this.cacheTtlMs,

          retryAttempts: this.retryAttempts,

          retryDelayMs: this.retryDelayMs,
        },
      );
    } catch (error: unknown) {
      this.logger.debug(
        `Hacker News item ${id} could not be collected: ${this.getErrorMessage(
          error,
        )}`,
      );

      return null;
    }
  }

  /**
   * Builds search terms from user keywords,
   * domain keywords, and domain name.
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

    return this.unique([...userKeywords, ...domainKeywords, ...fallbackDomain])
      .filter((term) => term.length >= 2)
      .slice(0, 8);
  }

  /**
   * Validates Hacker News stories.
   *
   * @param story Raw Hacker News story.
   * @returns True when valid.
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

    if (!url || content.length < 10) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates the final story score.
   *
   * Stories that do not match search terms are excluded.
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
   * Calculates base story relevance.
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

      publishedAt: this.parseUnixDate(story.time),
    });
  }

  /**
   * Adds score for search-term matches.
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

      if (pattern.test(title)) {
        bonus += 40;
      }

      if (pattern.test(body)) {
        bonus += 20;
      }

      if (pattern.test(url)) {
        bonus += 10;
      }

      if (pattern.test(content)) {
        bonus += 5;
      }
    }

    return bonus;
  }

  /**
   * Adds score for problem, need, feature,
   * cost, security, and workflow terms.
   */
  private calculateProblemBonus(story: HackerNewsItem): number {
    const title = this.cleanNormalizedText(story.title);

    const body = this.cleanNormalizedText(story.text);

    const content = `${title} ${body}`;

    const problemTerms = [
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

    for (const term of problemTerms) {
      if (content.includes(term)) {
        bonus += 6;
      }
    }

    return bonus;
  }

  /**
   * Maps a Hacker News story to CollectorPost.
   *
   * Hacker News does not expose geographical metadata,
   * so post location fields remain undefined.
   */
  private async mapStoryToCollectorPost(
    story: HackerNewsItem,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectStoryComments(story);

    const title = this.cleanPlainText(story.title);

    const content = this.cleanPlainText(story.text ?? story.title);

    return {
      externalId: story.id?.toString() ?? '',

      title,

      content: content || title,

      author: this.cleanPlainText(story.by),

      url: story.url ?? `${this.siteBaseUrl}/item?id=${story.id}`,

      country: undefined,
      city: undefined,
      region: undefined,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: story.score ?? 0,

      repliesCount: story.descendants ?? comments.length,

      publishedAt: this.parseUnixDate(story.time),

      comments,
    };
  }

  /**
   * Collects useful top-level comments.
   *
   * @param story Hacker News story.
   * @returns Useful comments.
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

        /*
         * Comment language is not detected independently.
         * Leaving it undefined is more accurate than copying
         * a requested ANY language value.
         */
        languageCode: undefined,

        likesCount: 0,

        publishedAt: this.parseUnixDate(comment.time),
      });
    }

    return comments;
  }

  /**
   * Validates Hacker News comments.
   *
   * @param comment Raw Hacker News comment.
   * @returns True when useful for NLP.
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
   * Detects generic comments that are not
   * useful for idea discovery.
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
   * Reads common and Hacker News-specific blocked words.
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
   * Parses a Unix timestamp safely.
   */
  private parseUnixDate(value?: number): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value * 1_000);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown Hacker News collector error.';
  }
}
