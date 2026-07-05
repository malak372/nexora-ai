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
 * Stack Overflow collector.
 *
 * Collects public programming-related questions and comments
 * from Stack Overflow using Stack Exchange API.
 *
 * Note:
 * Stack Overflow is a technical platform, so results are expected
 * to be stronger for software, programming, AI, databases, security,
 * education technology, healthcare software, and finance software topics.
 *
 * @author Malak
 */
@Injectable()
export class StackOverflowCollector
  extends BaseCollector
  implements SocialCollector {
  readonly sourceType = CollectionSourceType.STACKOVERFLOW;

  private readonly platformName = 'Stack Overflow';
  private readonly apiBaseUrl = 'https://api.stackexchange.com/2.3';

  constructor(configService: ConfigService) {
    super(configService, StackOverflowCollector.name);
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const queries = this.buildSearchQueries(input);

      if (!queries.length) {
        this.logger.warn(
          'Stack Overflow collection skipped because no search keywords exist.',
        );
        return [];
      }

      const allQuestions: any[] = [];

      for (const query of queries) {
        const cacheKey = CollectorCacheUtil.build('stackoverflow', 'questions', [
          query.q,
          query.title,
          query.body,
          query.tagged,
          input.country,
          input.language,
        ]);

        const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
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

        allQuestions.push(...(data?.items ?? []));
      }

      const seenQuestionIds = new Set<string>();

      const rankedQuestions = allQuestions
        .filter((question: any) => this.isValidQuestion(question))
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

  private buildSearchQueries(input: CollectorInput): Record<string, string>[] {
    const domainKeywords = this.getDomainKeywords(input);

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const keywords = this.unique([...domainKeywords, ...userKeywords]).slice(
      0,
      8,
    );

    if (!keywords.length) return [];

    const mainQuery = keywords.join(' ');
    const tags = this.buildTags(keywords);

    return [
      {
        q: mainQuery,
      },
      {
        title: mainQuery,
      },
      {
        body: mainQuery,
      },
      ...(tags
        ? [
          {
            tagged: tags,
          },
        ]
        : []),
    ];
  }

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

  private isValidQuestion(question: any): boolean {
    const title = question?.title ?? '';
    const body = question?.body ?? '';
    const content = this.normalizeText(`${title} ${this.stripHtml(body)}`);

    if (
      !question?.question_id ||
      !title ||
      !question?.link ||
      content.length < 50
    ) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

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

  private async mapQuestionToCollectorPost(
    question: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectQuestionComments(question);

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
        (question.answer_count ?? 0) +
        (question.comment_count ?? comments.length),
      publishedAt: question.creation_date
        ? new Date(question.creation_date * 1000)
        : undefined,
      comments,
    };
  }

  private async collectQuestionComments(
    question: any,
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
        .filter((comment: any) => this.isUsefulComment(comment))
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

  private isUsefulComment(comment: any): boolean {
    const content = this.normalizeText(this.stripHtml(comment?.body ?? ''));

    if (!comment?.comment_id || content.length < 30) {
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

  protected getBlockedWords(): string[] {
    return super.getBlockedWords('STACKOVERFLOW_BLOCKED_WORDS');
  }

  private getSite(): string {
    return (
      this.configService.get<string>('STACKOVERFLOW_SITE') || 'stackoverflow'
    );
  }

  private buildApiKeyParam(): Record<string, string> {
    const key = this.configService.get<string>('STACKOVERFLOW_API_KEY');

    return key ? { key } : {};
  }

  private buildHeaders(): Record<string, string> {
    return CollectorHeaderUtil.json();
  }
}