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
import { CollectorQueryBuilderUtil } from '../base/collector-query-builder.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Stack Overflow collector.
 *
 * Collects public Stack Overflow questions and comments using
 * Stack Exchange API.
 *
 * Strategy:
 * - Uses domainKeywords from the database as the main search context.
 * - Uses problem words to enrich the search query and relevance ranking.
 * - Keeps country, city, region, and language as request metadata only.
 * - Leaves deeper problem/need/sentiment detection to the NLP pipeline.
 *
 * Supports:
 * - Domain-based question search.
 * - Optional user keywords.
 * - Question and comment collection.
 * - Spam and irrelevant content filtering.
 * - Lightweight relevance ordering before storage limits.
 * - Deduplication inside the same collection run.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Centralized JSON headers through CollectorHeaderUtil.
 *
 * Notes:
 * - Stack Exchange API does not support real country/city filtering.
 * - Language filtering is not enforced here to avoid changing existing logic.
 *
 * @author Malak
 */
@Injectable()
export class StackOverflowCollector
  extends BaseCollector
  implements SocialCollector
{
  readonly sourceType = CollectionSourceType.STACKOVERFLOW;

  private readonly platformName = 'Stack Overflow';
  private readonly apiBaseUrl = 'https://api.stackexchange.com/2.3';

  constructor(configService: ConfigService) {
    super(configService, StackOverflowCollector.name);
  }

  /**
   * Collects public Stack Overflow questions and their useful comments.
   *
   * @param input Collection request context.
   * @returns A list of normalized collector posts.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Stack Overflow collection skipped because no domain keywords exist.',
        );
        return [];
      }

      const cacheKey = CollectorCacheUtil.build('stackoverflow', 'questions', [
        searchQuery,
        input.country,
        input.language,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
        `${this.apiBaseUrl}/search/advanced`,
        {
          headers: this.buildHeaders(),
          params: {
            q: searchQuery,
            site: this.getSite(),
            sort: 'activity',
            order: 'desc',
            pagesize: Math.min(this.maxFetchedPosts, 100),
            filter: 'withbody',
            ...this.buildApiKeyParam(),
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

      const questions = data?.items ?? [];
      const seenQuestionIds = new Set<string>();

      const rankedQuestions = questions
        .filter((question: any) => this.isValidQuestion(question))
        .filter((question: any) => this.matchesInputContext(question, input))
        .filter((question: any) => {
          const id = question?.question_id?.toString();

          if (!id || seenQuestionIds.has(id)) return false;

          seenQuestionIds.add(id);
          return true;
        })
        .map((question: any) => ({
          question,
          score: this.calculateQuestionRelevanceScore(question, input),
        }))
        .filter((item: any) => item.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedQuestions.map((item: any) =>
          this.mapQuestionToCollectorPost(item.question, input),
        ),
      );

      this.logger.log(
        `Stack Overflow collection completed. Posts: ${posts.length}`,
      );

      return posts;
    } catch (error: any) {
      this.logger.error(
        'Stack Overflow collection failed',
        error.response?.data ?? error.message,
      );

      throw new ServiceUnavailableException(
        'Stack Overflow collection failed. Check collector limits, API limits, or network connection.',
      );
    }
  }

  /**
   * Builds a Stack Overflow search query using domain keywords,
   * optional user keywords, and problem-related generated queries.
   *
   * @param input Collection request context.
   * @returns Search query string.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    if (!domainKeywords.length) return '';

    const problemWords = this.getProblemWords();

    const problemQueries = CollectorQueryBuilderUtil.buildProblemQueries(
      domainKeywords,
      problemWords,
    );

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([
      ...domainKeywords,
      ...userQueries,
      ...problemQueries,
    ])
      .slice(0, 8)
      .join(' ');
  }

  /**
   * Performs lightweight validation before mapping questions.
   *
   * @param question Raw Stack Overflow question object.
   * @returns True if the question is valid for collection.
   */
  private isValidQuestion(question: any): boolean {
    const title = question?.title ?? '';
    const body = question?.body ?? '';
    const content = this.normalizeText(`${title} ${this.stripHtml(body)}`);

    const blockedWords = this.getBlockedWords();

    return (
      Boolean(question?.question_id) &&
      Boolean(title) &&
      Boolean(question?.link) &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  /**
   * Checks whether the question belongs to the selected domain/context.
   *
   * @param question Raw Stack Overflow question object.
   * @param input Collection request context.
   * @returns True if the question text matches the requested context.
   */
  private matchesInputContext(question: any, input: CollectorInput): boolean {
    const content = this.normalizeText(
      `${question?.title ?? ''} ${this.stripHtml(question?.body ?? '')}`,
    );

    const domainKeywords = this.getDomainKeywords(input);
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const contextTerms = this.unique([...domainKeywords, ...userKeywords]);

    return contextTerms.some((term) => content.includes(term));
  }

  /**
   * Calculates a lightweight relevance score before applying storage limits.
   *
   * @param question Raw Stack Overflow question object.
   * @param input Collection request context.
   * @returns Numeric relevance score.
   */
  private calculateQuestionRelevanceScore(
    question: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: question?.title ?? '',
      body: this.stripHtml(question?.body ?? ''),
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: question.score ?? 0,
      replies: (question.answer_count ?? 0) + (question.comment_count ?? 0),
      publishedAt: question.creation_date
        ? new Date(question.creation_date * 1000)
        : undefined,
    });
  }

  /**
   * Maps a Stack Overflow question into the common CollectorPost format.
   *
   * @param question Raw Stack Overflow question object.
   * @param input Collection request context.
   * @returns Normalized collector post.
   */
  private async mapQuestionToCollectorPost(
    question: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectQuestionComments(question, input);

    return {
      sourceType: CollectionSourceType.STACKOVERFLOW,
      platformName: this.platformName,
      externalId: question.question_id.toString(),
      title: this.decodeHtml(question.title),
      content: this.stripHtml(question.body ?? question.title),
      author: question.owner?.display_name,
      url: question.link,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: question.score ?? 0,
      repliesCount:
        question.answer_count ?? question.comment_count ?? comments.length,
      publishedAt: question.creation_date
        ? new Date(question.creation_date * 1000)
        : undefined,
      comments,
    };
  }

  /**
   * Collects and maps useful comments for a Stack Overflow question.
   *
   * If comment collection fails, the question is still kept without comments.
   *
   * @param question Raw Stack Overflow question object.
   * @param input Collection request context.
   * @returns Normalized collector comments.
   */
  private async collectQuestionComments(
    question: any,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!question?.question_id) return [];

    try {
      const cacheKey = CollectorCacheUtil.build('stackoverflow', 'comments', [
        question.question_id,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
        `${this.apiBaseUrl}/questions/${question.question_id}/comments`,
        {
          headers: this.buildHeaders(),
          params: {
            site: this.getSite(),
            sort: 'votes',
            order: 'desc',
            pagesize: Math.min(this.maxFetchedComments, 100),
            filter: 'withbody',
            ...this.buildApiKeyParam(),
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

      const seenCommentIds = new Set<string>();

      return (data?.items ?? [])
        .filter((comment: any) => this.isUsefulComment(comment, input))
        .filter((comment: any) => {
          const id = comment?.comment_id?.toString();

          if (!id || seenCommentIds.has(id)) return false;

          seenCommentIds.add(id);
          return true;
        })
        .slice(0, this.maxSavedComments)
        .map((comment: any): CollectorComment => ({
          externalId: comment.comment_id.toString(),
          content: this.stripHtml(comment.body ?? ''),
          author: comment.owner?.display_name,
          likesCount: comment.score ?? 0,
          publishedAt: comment.creation_date
            ? new Date(comment.creation_date * 1000)
            : undefined,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Filters comments before storage.
   *
   * @param comment Raw Stack Overflow comment object.
   * @param input Collection request context.
   * @returns True if the comment is useful for the NLP pipeline.
   */
  private isUsefulComment(comment: any, input: CollectorInput): boolean {
    const content = this.normalizeText(this.stripHtml(comment?.body ?? ''));

    if (!comment?.comment_id || content.length < 20) return false;

    const blockedWords = this.getBlockedWords();

    if (blockedWords.some((word) => content.includes(word))) return false;

    const contextTerms = this.unique([
      ...this.getDomainKeywords(input),
      ...(input.keywords ?? []).map((keyword) => this.normalizeText(keyword)),
    ]).filter(Boolean);

    return contextTerms.some((term) => content.includes(term));
  }

  /**
   * Reads common blocked words and Stack Overflow-specific blocked words.
   *
   * @returns A normalized list of blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('STACKOVERFLOW_BLOCKED_WORDS');
  }

  /**
   * Returns the Stack Exchange site identifier.
   *
   * Defaults to "stackoverflow" if STACKOVERFLOW_SITE is not defined.
   *
   * @returns Stack Exchange site name.
   */
  private getSite(): string {
    return (
      this.configService.get<string>('STACKOVERFLOW_SITE') || 'stackoverflow'
    );
  }

  /**
   * Builds the optional Stack Exchange API key parameter.
   *
   * @returns Object containing the API key if configured.
   */
  private buildApiKeyParam(): Record<string, string> {
    const key = this.configService.get<string>('STACKOVERFLOW_API_KEY');

    return key ? { key } : {};
  }

  /**
   * Builds JSON request headers using the shared header utility.
   *
   * Keeps the previous behavior:
   * - Accepts JSON responses.
   * - Adds the project User-Agent.
   *
   * @returns HTTP request headers.
   */
  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
  }
}