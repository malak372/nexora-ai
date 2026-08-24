import { Injectable } from '@nestjs/common';
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

type HackerNewsAlgoliaHit = {
  objectID?: string;
  title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  author?: string | null;
  created_at_i?: number | null;
  points?: number | null;
  num_comments?: number | null;
};

type HackerNewsAlgoliaResponse = {
  hits?: HackerNewsAlgoliaHit[];
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

  /** Query-driven public search API backed by the Hacker News Algolia index. */
  private readonly searchApiUrl = 'https://hn.algolia.com/api/v1/search';
  private readonly searchByDateApiUrl = 'https://hn.algolia.com/api/v1/search_by_date';

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
      const searchQueries = this.buildSearchQueries(input);

      if (searchQueries.length === 0) {
        this.logger.warn(
          'Hacker News collection skipped because no search keywords exist.',
        );
        return [];
      }

      const hitGroups = await Promise.all(
        searchQueries.slice(0, 3).map((query) => this.searchStories(query)),
      );
      const seenIds = new Set<string>();
      const stories = hitGroups
        .flat()
        .filter((hit) => {
          const id = hit.objectID?.trim();
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        })
        .map((hit) => this.mapAlgoliaHitToStory(hit))
        .filter((story): story is HackerNewsItem => this.isValidStory(story))
        .slice(0, Math.min(this.maxFetchedPosts * 2, 18));
      const searchTerms = this.buildSearchTerms(input);
      const rankedStories = stories
        .map((story) => ({
          story,
          score: this.calculateFinalStoryScore(story, input, searchTerms),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const mapped = await Promise.all(
        rankedStories.map((item) => this.mapStoryToCollectorPost(item.story, input)),
      );
      const posts = mapped.filter(
        (post) => post.comments.length > 0 || post.content.length >= 80,
      );

      this.logger.log(
        `Hacker News query-driven collection completed. Queries=${searchQueries.length} Posts=${posts.length}`,
      );
      return posts;
    } catch (error: unknown) {
      this.logger.warn(
        `Hacker News query-driven collection failed non-fatally. error=${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async searchStories(query: string): Promise<HackerNewsAlgoliaHit[]> {
    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'algolia-search', [
      query,
    ]);
    const response = await CollectorHttpUtil.getWithRetryAndCache<HackerNewsAlgoliaResponse>(
      this.searchApiUrl,
      {
        headers: this.buildHeaders(),
        params: {
          query,
          tags: 'story',
          hitsPerPage: Math.min(Math.max(this.maxFetchedPosts * 2, 8), 20),
        },
        timeout: 4_500,
      },
      {
        cacheKey,
        cacheTtlMs: this.cacheTtlMs,
        retryAttempts: 0,
        retryDelayMs: this.retryDelayMs,
      },
    );
    return response.hits ?? [];
  }

  private buildSearchQueries(input: CollectorInput): string[] {
    const planned = (input.plannedQueries ?? [])
      .map((query) => this.relaxSearchQuery(query))
      .filter(Boolean);
    const fallback = this.buildSearchTerms(input)
      .map((term) => this.relaxSearchQuery(term))
      .filter(Boolean);
    return this.unique([...planned, ...fallback]).slice(0, 3);
  }

  private relaxSearchQuery(value: string): string {
    const stopWords = new Set([
      'problem', 'problems', 'issue', 'issues', 'complaint', 'complaints',
      'manual', 'business', 'businesses', 'workflow', 'workflows', 'system',
      'systems', 'difficult', 'failure', 'failures', 'delay', 'delayed',
    ]);
    return this.cleanNormalizedText(value)
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => !stopWords.has(token))
      .slice(0, 6)
      .join(' ');
  }

  private mapAlgoliaHitToStory(hit: HackerNewsAlgoliaHit): HackerNewsItem | null {
    const id = Number(hit.objectID);
    if (!Number.isFinite(id) || id <= 0 || !hit.title?.trim()) return null;
    return {
      id,
      type: 'story',
      title: hit.title,
      text: hit.story_text ?? undefined,
      url: hit.url ?? undefined,
      by: hit.author ?? undefined,
      time: hit.created_at_i ?? undefined,
      score: hit.points ?? 0,
      descendants: hit.num_comments ?? 0,
    };
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

    /*
     * Fetch only a bounded candidate window before relevance scoring.
     * The previous multiplier could issue hundreds of item requests for one
     * generation run even though only a small number of posts can be saved.
     */
    const candidateLimit = Math.min(this.maxFetchedPosts * 3, 48);

    for (const storyId of storyIds.slice(0, candidateLimit)) {
      if (stories.length >= this.maxFetchedPosts) {
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
    if (!story.id || (story.descendants ?? 0) <= 0) return [];

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'algolia-comments', [
        story.id,
      ]);
      const response = await CollectorHttpUtil.getWithRetryAndCache<HackerNewsAlgoliaResponse>(
        this.searchByDateApiUrl,
        {
          headers: this.buildHeaders(),
          params: {
            tags: `comment,story_${story.id}`,
            hitsPerPage: Math.min(Math.max(this.maxFetchedComments, 8), 30),
          },
          timeout: 3_000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: 0,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const seen = new Set<string>();
      return (response.hits ?? [])
        .map((hit): HackerNewsItem | null => {
          const id = Number(hit.objectID);
          if (!Number.isFinite(id) || id <= 0 || !hit.comment_text) return null;
          return {
            id,
            type: 'comment',
            text: hit.comment_text,
            by: hit.author ?? undefined,
            time: hit.created_at_i ?? undefined,
          };
        })
        .filter((comment): comment is HackerNewsItem => this.isUsefulComment(comment))
        .filter((comment) => {
          const id = comment.id?.toString() ?? '';
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, this.maxSavedComments)
        .map((comment) => ({
          externalId: comment.id!.toString(),
          content: this.cleanPlainText(comment.text),
          author: this.cleanPlainText(comment.by),
          languageCode: undefined,
          likesCount: 0,
          publishedAt: this.parseUnixDate(comment.time),
        }));
    } catch (error: unknown) {
      this.logger.debug(
        `Hacker News comments could not be collected for story ${story.id}: ${this.getErrorMessage(error)}`,
      );
      return [];
    }
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
