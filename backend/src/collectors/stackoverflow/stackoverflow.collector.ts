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
 * Collects public programming-related questions and comments
 * from Stack Overflow using Stack Exchange API.
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
   * Collects Stack Overflow questions, ranks them,
   * and maps them into the unified CollectorPost format.
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
          'stackoverflow',
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

        const data = await CollectorHttpUtil.getWithRetryAndCache<
          StackOverflowResponse<StackOverflowQuestion>
        >(
          `${this.apiBaseUrl}/search/advanced`,
          {
            headers: this.buildHeaders(),
            params: {
              site: this.getSite(),
              sort: 'activity',
              order: 'desc',
              pagesize: Math.min(this.maxFetchedPosts, 100),
              filter: 'withbody',
              ...query,
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

        allQuestions.push(...(data.items ?? []));
      }

      const seenQuestionIds = new Set<string>();

      const rankedQuestions = allQuestions
        .filter((question) => this.isValidQuestion(question))
        .filter((question) => {
          const id = question.question_id?.toString();

          if (!id || seenQuestionIds.has(id)) return false;

          seenQuestionIds.add(id);
          return true;
        })
        .map((question) => ({
          question,
          score: this.calculateQuestionRelevanceScore(question, input),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
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
   * Builds multiple search queries to improve Stack Overflow coverage.
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

    return keywords.slice(0, 5).map((keyword) => ({
      q: keyword,
    }));
  }

  /**
   * Builds Stack Overflow tag query from known keywords.
   */
  private buildTags(keywords: string[]): string {
    const tagMap: Record<string, string> = {
      ai: 'artificial-intelligence',
      ml: 'machine-learning',
      machine: 'machine-learning',
      learning: 'machine-learning',
      database: 'database',
      db: 'database',
      sql: 'sql',
      postgres: 'postgresql',
      postgresql: 'postgresql',
      backend: 'backend',
      frontend: 'frontend',
      web: 'web',
      mobile: 'mobile',
      flutter: 'flutter',
      react: 'reactjs',
      node: 'node.js',
      nest: 'nestjs',
      nestjs: 'nestjs',
      education: 'education',
      healthcare: 'healthcare',
      finance: 'finance',
      security: 'security',
      authentication: 'authentication',
      payment: 'payment',
      api: 'api',
    };

    const tags = keywords
      .map((keyword) => tagMap[keyword] ?? keyword)
      .map((tag) => tag.replace(/\s+/g, '-'))
      .filter((tag) => tag.length >= 2)
      .slice(0, 5);

    return this.unique(tags).join(';');
  }

  /**
   * Validates Stack Overflow question before ranking and mapping.
   */
  private isValidQuestion(question: StackOverflowQuestion): boolean {
    const title = question.title ?? '';
    const body = question.body ?? '';
    const content = this.normalizeText(`${title} ${this.stripHtml(body)}`);

    if (
      !question.question_id ||
      !title ||
      !question.link ||
      content.length < 50
    ) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Calculates relevance score for a Stack Overflow question.
   */
  private calculateQuestionRelevanceScore(
    question: StackOverflowQuestion,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: question.title ?? '',
      body: this.stripHtml(question.body ?? ''),
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
   * Maps Stack Overflow question to the unified CollectorPost format.
   */
  private async mapQuestionToCollectorPost(
    question: StackOverflowQuestion,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectQuestionComments(question);

    return {
      sourceType: CollectionSourceType.STACKOVERFLOW,
      platformName: this.platformName,
      externalId: question.question_id?.toString() ?? '',
      title: this.decodeHtml(question.title ?? ''),
      content: this.stripHtml(question.body ?? question.title ?? ''),
      author: question.owner?.display_name,
      url: question.link,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: question.score ?? 0,
      repliesCount:
        (question.answer_count ?? 0) +
        (question.comment_count ?? comments.length),
      publishedAt: question.creation_date
        ? new Date(question.creation_date * 1000)
        : undefined,
      comments,
    };
  }

  /**
   * Collects useful comments for a Stack Overflow question.
   */
  private async collectQuestionComments(
    question: StackOverflowQuestion,
  ): Promise<CollectorComment[]> {
    if (!question.question_id) return [];

    try {
      const cacheKey = CollectorCacheUtil.build('stackoverflow', 'comments', [
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

      return (data.items ?? [])
        .filter((comment) => this.isUsefulComment(comment))
        .filter((comment) => {
          const id = comment.comment_id?.toString();

          if (!id || seenCommentIds.has(id)) return false;

          seenCommentIds.add(id);
          return true;
        })
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: comment.comment_id?.toString() ?? '',
            content: this.stripHtml(comment.body ?? ''),
            author: comment.owner?.display_name,
            likesCount: comment.score ?? 0,
            publishedAt: comment.creation_date
              ? new Date(comment.creation_date * 1000)
              : undefined,
          }),
        );
    } catch {
      return [];
    }
  }

  /**
   * Filters short, low-value, empty, or blocked comments.
   */
  private isUsefulComment(comment: StackOverflowComment): boolean {
    const content = this.normalizeText(this.stripHtml(comment.body ?? ''));

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

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Reads common blocked words and Stack Overflow-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('STACKOVERFLOW_BLOCKED_WORDS');
  }

  /**
   * Reads Stack Exchange site from environment variables.
   */
  private getSite(): string {
    return (
      this.configService.get<string>('STACKOVERFLOW_SITE') || 'stackoverflow'
    );
  }

  /**
   * Builds optional Stack Exchange API key params.
   */
  private buildApiKeyParam(): Record<string, string> {
    const key = this.configService.get<string>('STACKOVERFLOW_API_KEY');

    return key ? { key } : {};
  }

  /**
   * Builds Stack Exchange API headers.
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
