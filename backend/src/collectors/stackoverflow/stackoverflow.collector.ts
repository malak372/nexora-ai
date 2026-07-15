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
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

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

  private readonly apiBaseUrl =
    'https://api.stackexchange.com/2.3';

  constructor(configService: ConfigService) {
    super(configService, StackOverflowCollector.name);
  }

  /**
   * Collects and ranks Stack Overflow questions.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const queries = this.buildSearchQueries(input);

      if (!queries.length) {
        this.logger.warn(
          'Stack Overflow collection skipped because no search keywords exist.',
        );

        return [];
      }

      const allQuestions: StackOverflowQuestion[] = [];

      for (const query of queries) {
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

        const data =
          await CollectorHttpUtil.getWithRetryAndCache<
            StackOverflowResponse<StackOverflowQuestion>
          >(
            `${this.apiBaseUrl}/search/advanced`,
            {
              headers: this.buildHeaders(),

              params: {
                site: this.getSite(),
                sort: 'activity',
                order: 'desc',
                pagesize: Math.min(
                  this.maxFetchedPosts,
                  100,
                ),
                filter: 'withbody',
                ...query,
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

        allQuestions.push(...(data.items ?? []));
      }

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
          score: this.calculateQuestionRelevanceScore(
            question,
            input,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedQuestions.map((item) =>
          this.mapQuestionToCollectorPost(
            item.question,
            input,
          ),
        ),
      );

      this.logger.log(
        `Stack Overflow collection completed. Posts: ${posts.length}`,
      );

      return posts;
    } catch (error: unknown) {
      this.logger.error(
        'Stack Overflow collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'Stack Overflow collection failed. Check collector limits, API limits, or network connection.',
      );
    }
  }

  /**
   * Builds Stack Overflow search queries.
   */
  private buildSearchQueries(
    input: CollectorInput,
  ): StackOverflowSearchQuery[] {
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const keywords = userKeywords.length
      ? userKeywords
      : this.getDomainKeywords(input);

    return keywords
      .slice(0, 5)
      .map((keyword) => ({
        q: keyword,
      }));
  }

  /**
   * Validates one question.
   */
  private isValidQuestion(
    question: StackOverflowQuestion,
  ): boolean {
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
      replies:
        (question.answer_count ?? 0) +
        (question.comment_count ?? 0),
      publishedAt: this.parseUnixDate(
        question.creation_date,
      ),
    });
  }

  /**
   * Maps a Stack Overflow question.
   */
  private async mapQuestionToCollectorPost(
    question: StackOverflowQuestion,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments =
      await this.collectQuestionComments(question);

    return {
      externalId:
        question.question_id?.toString() ?? '',

      title: this.cleanPlainText(question.title),

      content: this.cleanPlainText(
        question.body ?? question.title,
      ),

      author: this.cleanPlainText(
        question.owner?.display_name,
      ),

      url: question.link,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(
        input.language,
      ),

      likesCount: question.score ?? 0,

      repliesCount:
        (question.answer_count ?? 0) +
        (question.comment_count ?? comments.length),

      publishedAt: this.parseUnixDate(
        question.creation_date,
      ),

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
      const cacheKey = CollectorCacheUtil.build(
        this.sourceKey,
        'comments',
        [question.question_id],
      );

      const data =
        await CollectorHttpUtil.getWithRetryAndCache<
          StackOverflowResponse<StackOverflowComment>
        >(
          `${this.apiBaseUrl}/questions/${question.question_id}/comments`,
          {
            headers: this.buildHeaders(),

            params: {
              site: this.getSite(),
              sort: 'votes',
              order: 'desc',
              pagesize: Math.min(
                this.maxFetchedComments,
                100,
              ),
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
            externalId:
              comment.comment_id?.toString() ?? '',

            content: this.cleanPlainText(comment.body),

            author: this.cleanPlainText(
              comment.owner?.display_name,
            ),

            likesCount: comment.score ?? 0,

            publishedAt: this.parseUnixDate(
              comment.creation_date,
            ),
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
  private isUsefulComment(
    comment: StackOverflowComment,
  ): boolean {
    const content = this.cleanNormalizedText(comment.body);

    if (!comment.comment_id || content.length < 30) {
      return false;
    }

    const cleaned = content
      .replace(/[^\p{L}\p{N}\s+]/gu, '')
      .trim();

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
    return super.getBlockedWords(
      'STACKOVERFLOW_BLOCKED_WORDS',
    );
  }

  /**
   * Reads the Stack Exchange site name.
   */
  private getSite(): string {
    return (
      this.configService.get<string>('STACKOVERFLOW_SITE') ??
      'stackoverflow'
    );
  }

  /**
   * Builds optional Stack Exchange API-key parameters.
   */
  private buildApiKeyParam(): Record<string, string> {
    const key =
      this.configService.get<string>(
        'STACKOVERFLOW_API_KEY',
      );

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
  private parseUnixDate(
    value?: number,
  ): Date | undefined {
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