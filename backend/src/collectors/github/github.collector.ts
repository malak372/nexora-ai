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

type GitHubUser = {
  login?: string;
};

type GitHubLabel = {
  name?: string;
};

type GitHubReactions = {
  total_count?: number;
};

type GitHubIssue = {
  id?: number;
  title?: string;
  body?: string;
  html_url?: string;
  comments_url?: string;
  comments?: number;
  created_at?: string;
  pull_request?: unknown;
  user?: GitHubUser;
  labels?: GitHubLabel[];
  reactions?: GitHubReactions;
};

type GitHubComment = {
  id?: number;
  body?: string;
  created_at?: string;
  user?: GitHubUser;
  reactions?: GitHubReactions;
};

type GitHubSearchResponse = {
  items?: GitHubIssue[];
};

/**
 * GitHub collector.
 *
 * Collects public GitHub issues and issue comments using GitHub REST API.
 *
 * Features:
 * - Domain-based issue search.
 * - Optional user keywords.
 * - Pull request exclusion.
 * - General discussion filtering.
 * - Spam, jobs, bots, and low-value comments filtering.
 * - Relevance scoring.
 * - Deduplication.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - ETag / If-None-Match support.
 * - GitHub rate-limit monitoring.
 *
 * Notes:
 * - GitHub does not support real country/city filtering for public issues.
 * - country, city, region, and language are stored as request metadata only.
 *
 * @author Malak
 */
@Injectable()
export class GitHubCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.GITHUB;

  private readonly platformName = 'GitHub';
  private readonly apiBaseUrl = 'https://api.github.com';

  constructor(configService: ConfigService) {
    super(configService, GitHubCollector.name);
  }

  /**
   * Collects GitHub issues, ranks them, and maps them
   * into the unified CollectorPost format.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'GitHub collection skipped because no domain keywords exist.',
        );
        return [];
      }

      const cacheKey = CollectorCacheUtil.build('github', 'issues', [
        searchQuery,
        input.country,
        input.language,
      ]);

      const response =
        await CollectorHttpUtil.getWithRetryCacheAndHeaders<GitHubSearchResponse>(
          `${this.apiBaseUrl}/search/issues`,
          {
            headers: this.buildHeaders(),
            params: {
              q: searchQuery,
              sort: 'updated',
              order: 'desc',
              per_page: Math.min(this.maxFetchedPosts, 100),
            },
            timeout: 10000,
          },
          {
            cacheKey,
            etagCacheKey: `${cacheKey}:etag`,
            cacheTtlMs: this.cacheTtlMs,
            retryAttempts: this.retryAttempts,
            retryDelayMs: this.retryDelayMs,
          },
        );

      this.monitorGitHubRateLimit(response.headers);

      const issues = response.data.items ?? [];
      const seenIssueIds = new Set<string>();

      const rankedIssues = issues
        .filter((issue) => this.isValidIssue(issue))
        .filter((issue) => {
          const id = issue.id?.toString();

          if (!id || seenIssueIds.has(id)) {
            return false;
          }

          seenIssueIds.add(id);
          return true;
        })
        .map((issue) => ({
          issue,
          score: this.calculateIssueRelevanceScore(issue, input),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedIssues.map((item) =>
          this.mapIssueToCollectorPost(item.issue, input),
        ),
      );

      this.logger.log(`GitHub collection completed. Posts: ${posts.length}`);

      return posts;
    } catch (error: unknown) {
      this.logger.error('GitHub collection failed', this.getErrorMessage(error));

      throw new ServiceUnavailableException(
        'GitHub collection failed. Check GitHub token, collector limits, API limits, or network connection.',
      );
    }
  }

  /**
   * Builds GitHub issue search query from domain and user keywords.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    if (!domainKeywords.length) {
      return '';
    }

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const domainName = input.domainName
      ? this.normalizeText(input.domainName)
      : '';

    const terms = this.unique([
      domainName,
      ...domainKeywords,
      ...userQueries,
    ])
      .filter((term) => term.length >= 3)
      .slice(0, 5);

    const searchTerms = terms.map((term) => `"${term}"`).join(' OR ');

    return [
      `(${searchTerms})`,
      'in:title,body',
      'is:issue',
      '-is:pr',
      'state:open',
      'comments:>1',
      'updated:>2025-01-01',
      '-label:discussion',
      '-label:question',
      '-label:documentation',
      '-label:"good first issue"',
      '-label:"help wanted"',
    ].join(' ');
  }

  /**
   * Validates GitHub issue before ranking and mapping.
   */
  private isValidIssue(issue: GitHubIssue): boolean {
    const title = issue.title ?? '';
    const body = issue.body ?? '';
    const author = issue.user?.login ?? '';
    const url = issue.html_url ?? '';

    const normalizedTitle = this.normalizeText(title);
    const content = this.normalizeText(`${title} ${body}`);
    const labels = this.getIssueLabelsText(issue);
    const blockedWords = this.getBlockedWords();

    if (
      !issue.id ||
      !title ||
      !url ||
      issue.pull_request ||
      (issue.comments ?? 0) <= 1 ||
      author.includes('[bot]') ||
      url.includes('/jobs/') ||
      content.length < 80
    ) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s+]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    if (blockedWords.some((word) => content.includes(word))) {
      return false;
    }

    if (this.hasBlockedIssueLabel(labels)) {
      return false;
    }

    if (this.isGeneralDiscussionIssue(issue)) {
      return false;
    }

    if (this.hasIgnoredIssueTitle(normalizedTitle)) {
      return false;
    }

    return true;
  }

  /**
   * Calculates relevance score for a GitHub issue.
   */
  private calculateIssueRelevanceScore(
    issue: GitHubIssue,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: issue.title ?? '',
      body: issue.body ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: issue.reactions?.total_count ?? 0,
      replies: issue.comments ?? 0,
      publishedAt: issue.created_at ? new Date(issue.created_at) : undefined,
    });
  }

  /**
   * Maps a GitHub issue to the unified CollectorPost format.
   */
  private async mapIssueToCollectorPost(
    issue: GitHubIssue,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectIssueComments(issue, input);

    return {
      sourceType: CollectionSourceType.GITHUB,
      platformName: this.platformName,
      externalId: issue.id?.toString() ?? '',
      title: issue.title,
      content: issue.body ?? issue.title ?? '',
      author: issue.user?.login,
      url: issue.html_url,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: issue.reactions?.total_count ?? 0,
      repliesCount: issue.comments ?? comments.length,
      publishedAt: issue.created_at ? new Date(issue.created_at) : undefined,
      comments,
    };
  }

  /**
   * Collects useful comments for a GitHub issue.
   */
  private async collectIssueComments(
    issue: GitHubIssue,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!issue.comments_url || !issue.comments) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build('github', 'comments', [
        issue.id,
      ]);

      const response =
        await CollectorHttpUtil.getWithRetryCacheAndHeaders<GitHubComment[]>(
          issue.comments_url,
          {
            headers: this.buildHeaders(),
            params: {
              per_page: Math.min(this.maxFetchedComments, 100),
            },
            timeout: 10000,
          },
          {
            cacheKey,
            etagCacheKey: `${cacheKey}:etag`,
            cacheTtlMs: this.cacheTtlMs,
            retryAttempts: this.retryAttempts,
            retryDelayMs: this.retryDelayMs,
          },
        );

      this.monitorGitHubRateLimit(response.headers);

      const data = response.data;
      const seenCommentIds = new Set<string>();

      return (data ?? [])
        .filter((comment) => this.isUsefulComment(comment, input))
        .filter((comment) => {
          const id = comment.id?.toString();

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);
          return true;
        })
        .sort(
          (a, b) =>
            (b.reactions?.total_count ?? 0) -
            (a.reactions?.total_count ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map((comment): CollectorComment => ({
          externalId: comment.id?.toString() ?? '',
          content: comment.body ?? '',
          author: comment.user?.login,
          likesCount: comment.reactions?.total_count ?? 0,
          publishedAt: comment.created_at
            ? new Date(comment.created_at)
            : undefined,
        }));
    } catch (error: unknown) {
      this.logger.warn(
        `GitHub comments collection failed for issue ${issue.id}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Validates a GitHub comment before saving it.
   */
  private isUsefulComment(
    comment: GitHubComment,
    _input: CollectorInput,
  ): boolean {
    const author = comment.user?.login ?? '';
    const content = this.normalizeText(comment.body ?? '');

    if (!comment.id || content.length < 50 || author.includes('[bot]')) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s+]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    if (this.isLowValueComment(comment.body ?? content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Detects short operational comments that do not help idea generation.
   */
  private isLowValueComment(content: string): boolean {
    const patterns = [
      /\bthanks\b/i,
      /\bthank you\b/i,
      /\bgreat\b/i,
      /\bgood\b/i,
      /\bnice\b/i,
      /^\+1$/i,
      /\bsame\b/i,
      /\bme too\b/i,
      /\bworks\b/i,
      /\bfixed\b/i,
      /\bsolved\b/i,
      /\bresolved\b/i,
      /\bclosed\b/i,
      /\bclosing\b/i,
      /\bmerged\b/i,
      /\bapproved\b/i,
      /\bduplicate\b/i,
      /\bin review\b/i,
      /\bstarting work\b/i,
      /\bwork submitted\b/i,
      /\bpost-merge\b/i,
      /\bplease assign\b/i,
      /\bassign it to me\b/i,
      /\bassign me\b/i,
      /\bcan you assign\b/i,
      /\bi would like to work\b/i,
      /\bunder gssoc\b/i,
      /\bunder gsoc\b/i,
      /\bunder ecsoc\b/i,
      /\bunder ssoc\b/i,
      /\/assign/i,
      /\bstart_work\.sh\b/i,
      /\breview_work\.sh\b/i,
    ];

    return patterns.some((pattern) => pattern.test(content));
  }

  /**
   * Checks whether issue labels indicate low-value collection data.
   */
  private hasBlockedIssueLabel(labels: string): boolean {
    const blockedLabels = [
      'good first issue',
      'first timers only',
      'help wanted',
      'gssoc',
      'gsoc',
      'ecsoc',
      'ssoc',
      'hacktoberfest',
      'documentation',
      'question',
      'discussion',
    ];

    return blockedLabels.some((word) => labels.includes(word));
  }

  /**
   * Checks whether issue title indicates a discussion or maintenance task.
   */
  private hasIgnoredIssueTitle(title: string): boolean {
    const ignoredTitleTerms = [
      'general discussion',
      'discussion',
      'chat',
      'random',
      'off topic',
      'off-topic',
      'announcement',
      'show and tell',
      'paper note',
      'post-merge',
      'release',
      'chore',
      'docs:',
      'doc:',
    ];

    return ignoredTitleTerms.some((word) => title.includes(word));
  }

  /**
   * Detects general discussion issues.
   */
  private isGeneralDiscussionIssue(issue: GitHubIssue): boolean {
    const title = this.normalizeText(issue.title ?? '');
    const labels = this.getIssueLabelsText(issue);
    const text = `${title} ${labels}`;

    const generalDiscussionTerms = [
      'general discussion',
      'discussion',
      'chat',
      'random',
      'off topic',
      'off-topic',
      'announcement',
      'show and tell',
    ];

    return generalDiscussionTerms.some((term) => text.includes(term));
  }

  /**
   * Converts GitHub issue labels into normalized text.
   */
  private getIssueLabelsText(issue: GitHubIssue): string {
    return (issue.labels ?? [])
      .map((label) => this.normalizeText(label.name ?? ''))
      .join(' ');
  }

  /**
   * Logs a warning when GitHub remaining requests are low.
   */
  private monitorGitHubRateLimit(headers: Record<string, unknown>): void {
    const remaining = Number(headers['x-ratelimit-remaining']);
    const limit = Number(headers['x-ratelimit-limit']);
    const reset = Number(headers['x-ratelimit-reset']);

    if (Number.isNaN(remaining)) {
      return;
    }

    if (remaining <= 10) {
      const resetDate = reset
        ? new Date(reset * 1000).toISOString()
        : 'unknown';

      this.logger.warn(
        `GitHub rate limit is low. Remaining: ${
          remaining
        }/${limit || 'unknown'}. Reset: ${resetDate}`,
      );
    }
  }

  /**
   * Reads common blocked words and GitHub-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GITHUB_BLOCKED_WORDS');
  }

  /**
   * Builds GitHub REST API headers.
   */
  private buildHeaders(): Record<string, string> {
    const token = this.configService.get<string>('GITHUB_TOKEN');

    return CollectorHeaderUtil.github(token);
  }

  /**
   * Extracts readable error message from unknown errors.
   */
  private getErrorMessage(error: unknown): unknown {
    if (error instanceof Error) {
      return error.message;
    }

    return error;
  }
}