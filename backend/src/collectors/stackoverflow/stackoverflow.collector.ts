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
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { CollectorQueryBuilderUtil } from '../base/collector-query-builder.util';

type StackOverflowOwner = {
  display_name?: string;
};

type StackOverflowQuestion = {
  question_id?: number;
  title?: string;
  body?: string;
  link?: string;
  score?: number;
  answer_count?: number;
  comment_count?: number;
  creation_date?: number;
  owner?: StackOverflowOwner;
};

type StackOverflowComment = {
  comment_id?: number;
  body?: string;
  score?: number;
  creation_date?: number;
  owner?: StackOverflowOwner;
};

type StackOverflowResponse<T> = {
  items?: T[];
};

type StackOverflowSearchQuery = {
  q?: string;
  title?: string;
  body?: string;
  tagged?: string;
};

/**
 * Stack Overflow collector.
 *
 * Collects public programming questions and comments.
 *
 * @author Malak
 */
@Injectable()
export class StackOverflowCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'stackoverflow';

  private readonly apiBaseUrl = 'https://api.stackexchange.com/2.3';

  private static throttleBlockedUntil = 0;

  constructor(configService: ConfigService) {
    super(configService, StackOverflowCollector.name);
  }

  /**
   * Collects and ranks Stack Overflow questions.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    if (Date.now() < StackOverflowCollector.throttleBlockedUntil) {
      const remainingSeconds = Math.ceil(
        (StackOverflowCollector.throttleBlockedUntil - Date.now()) / 1000,
      );
      this.logger.warn(
        `Stack Overflow collection skipped because the API throttle is active for approximately ${remainingSeconds} more second(s).`,
      );
      return [];
    }

    try {
      const queries = this.buildSearchQueries(input);

      if (!queries.length) {
        this.logger.warn(
          'Stack Overflow collection skipped because no search keywords exist.',
        );

        return [];
      }

      const queryResults = await Promise.allSettled(
        queries.map(async (query) => {
          const cacheKey = CollectorCacheUtil.build(
            this.sourceKey,
            'questions',
            [
              query.q,
              query.title,
              query.body,
              query.tagged,
              input.country,
              input.language,
            ],
          );

          return CollectorHttpUtil.getWithRetryAndCache<
            StackOverflowResponse<StackOverflowQuestion>
          >(
            `${this.apiBaseUrl}/search/advanced`,
            {
              headers: this.buildHeaders(),
              params: {
                site: this.getSite(),
                sort: 'activity',
                order: 'desc',
                pagesize: Math.min(this.maxFetchedPosts, 30),
                filter: 'withbody',
                ...query,
                ...this.buildApiKeyParam(),
              },
              timeout:
                input.collectionMode === 'FAST_GENERATION' ||
                input.collectionMode === 'TARGETED_RECOVERY'
                  ? 4_500
                  : 10_000,
            },
            {
              cacheKey,
              cacheTtlMs: this.cacheTtlMs,
              retryAttempts:
                input.collectionMode === 'FAST_GENERATION' ||
                input.collectionMode === 'TARGETED_RECOVERY'
                  ? 0
                  : this.retryAttempts,
              retryDelayMs: this.retryDelayMs,
            },
          );
        }),
      );

      const rejectedResults = queryResults.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      const throttleSeconds = this.resolveThrottleSeconds(
        rejectedResults.map((result) => result.reason),
      );

      if (throttleSeconds !== null) {
        StackOverflowCollector.throttleBlockedUntil =
          Date.now() + Math.max(throttleSeconds, 60) * 1000;
        this.logger.warn(
          `Stack Overflow API throttle detected. Future collection attempts will be skipped for ${throttleSeconds} second(s).`,
        );
      }

      const allQuestions = queryResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.items ?? [] : [],
      );

      const seenQuestionIds = new Set<string>();

      const rankedQuestions = allQuestions
        .filter((question) => this.isValidQuestion(question))
        .filter((question) => {
          const id = question.question_id?.toString();

          if (!id || seenQuestionIds.has(id)) {
            return false;
          }

          seenQuestionIds.add(id);

          return true;
        })
        .map((question) => ({
          question,
          score: this.calculateQuestionRelevanceScore(question, input),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedQuestions.map((item) =>
          this.mapQuestionToCollectorPost(item.question, input),
        ),
      );

      this.logger.log(
        `Stack Overflow collection completed. Posts: ${posts.length}`,
      );

      return posts;
    } catch (error: unknown) {
      const errorMessage = this.getErrorMessage(error);
      const providerMessage = this.extractProviderErrorMessage(error);
      const throttleMatch = `${errorMessage} ${providerMessage}`.match(
        /more requests available in\s+(\d+)\s+seconds/iu,
      );

      if (throttleMatch) {
        const throttleSeconds = Number(throttleMatch[1]);
        StackOverflowCollector.throttleBlockedUntil =
          Date.now() + Math.max(throttleSeconds, 60) * 1000;
        this.logger.warn(
          `Stack Overflow collection skipped because the API throttle limit was reached. Cooldown: ${throttleSeconds} second(s).`,
        );
        return [];
      }

      this.logger.error('Stack Overflow collection failed', errorMessage);

      throw new ServiceUnavailableException(
        'Stack Overflow collection failed. Check collector limits, API limits, or network connection.',
      );
    }
  }

  /**
   * Extracts Stack Exchange error_message from an Axios-like error without
   * introducing an unsafe any assignment.
   */
  private extractProviderErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object' || !('response' in error)) {
      return '';
    }

    const response = (error as { response?: unknown }).response;

    if (!response || typeof response !== 'object' || !('data' in response)) {
      return '';
    }

    const data = (response as { data?: unknown }).data;

    if (!data || typeof data !== 'object' || !('error_message' in data)) {
      return '';
    }

    const message = (data as { error_message?: unknown }).error_message;

    return typeof message === 'string' ? message : '';
  }


  private resolveThrottleSeconds(errors: readonly unknown[]): number | null {
    for (const error of errors) {
      const combined = `${this.getErrorMessage(error)} ${this.extractProviderErrorMessage(error)}`;
      const match = combined.match(
        /more requests available in\s+(\d+)\s+seconds/iu,
      );

      if (match) {
        return Number(match[1]);
      }
    }

    return null;
  }

  /**
   * Builds Stack Overflow search queries.
   */
  private buildSearchQueries(
    input: CollectorInput,
  ): StackOverflowSearchQuery[] {
    const isBoundedMode =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';
    const technicalQueries =
      CollectorQueryBuilderUtil.buildStackOverflowTechnicalQueries({
        domainName: input.domainName,
        userKeywords: [
          ...(input.domainKeywords ?? []),
          ...(input.keywords ?? []),
        ],
        // The queries execute concurrently, so three selected-domain anchors
        // improve recall without creating three sequential network waits.
        maxQueries: isBoundedMode ? 3 : 6,
      });

    return technicalQueries.map((query, index) =>
      index === 0 ? { title: query } : { q: query },
    );
  }

  /**
   * Validates one question.
   */
  private isValidQuestion(question: StackOverflowQuestion): boolean {
    const title = this.cleanPlainText(question.title);
    const body = this.cleanPlainText(question.body);
    const content = this.cleanNormalizedText(`${title} ${body}`);

    if (
      !question.question_id ||
      !title ||
      !question.link ||
      content.length < 50
    ) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates question relevance.
   */
  private calculateQuestionRelevanceScore(
    question: StackOverflowQuestion,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(question.title),
      body: this.cleanPlainText(question.body),
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: question.score ?? 0,
      replies: (question.answer_count ?? 0) + (question.comment_count ?? 0),
      publishedAt: this.parseUnixDate(question.creation_date),
    });
  }

  /**
   * Maps a Stack Overflow question.
   */
  private async mapQuestionToCollectorPost(
    question: StackOverflowQuestion,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectQuestionComments(question);

    return {
      externalId: question.question_id?.toString() ?? '',

      title: this.cleanPlainText(question.title),

      content: this.cleanPlainText(question.body ?? question.title),

      author: this.cleanPlainText(question.owner?.display_name),

      url: question.link,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: question.score ?? 0,

      repliesCount:
        (question.answer_count ?? 0) +
        (question.comment_count ?? comments.length),

      publishedAt: this.parseUnixDate(question.creation_date),

      comments,
    };
  }

  /**
   * Collects question comments.
   */
  private async collectQuestionComments(
    question: StackOverflowQuestion,
  ): Promise<CollectorComment[]> {
    if (!question.question_id) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'comments', [
        question.question_id,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<
        StackOverflowResponse<StackOverflowComment>
      >(
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
        .filter((comment) => this.isUsefulComment(comment))
        .filter((comment) => {
          const id = comment.comment_id?.toString();

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);

          return true;
        })
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: comment.comment_id?.toString() ?? '',

            content: this.cleanPlainText(comment.body),

            author: this.cleanPlainText(comment.owner?.display_name),

            likesCount: comment.score ?? 0,

            publishedAt: this.parseUnixDate(comment.creation_date),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Stack Overflow comments collection failed for question ${question.question_id}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Filters low-value comments.
   */
  private isUsefulComment(comment: StackOverflowComment): boolean {
    const content = this.cleanNormalizedText(comment.body);

    if (!comment.comment_id || content.length < 30) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s+]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    const lowValueComments = new Set([
      'thanks',
      'thank you',
      'great',
      'good',
      'nice',
      '+1',
      'same',
      'me too',
      'works',
      'fixed',
      'solved',
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
   * Reads Stack Overflow-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('STACKOVERFLOW_BLOCKED_WORDS');
  }

  /**
   * Reads the Stack Exchange site name.
   */
  private getSite(): string {
    return (
      this.configService.get<string>('STACKOVERFLOW_SITE') ?? 'stackoverflow'
    );
  }

  /**
   * Builds optional Stack Exchange API-key parameters.
   */
  private buildApiKeyParam(): Record<string, string> {
    const key = this.configService.get<string>('STACKOVERFLOW_API_KEY');

    return key ? { key } : {};
  }

  /**
   * Builds Stack Exchange headers.
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

    return typeof error === 'string'
      ? error
      : 'Unknown Stack Overflow collector error.';
  }
}