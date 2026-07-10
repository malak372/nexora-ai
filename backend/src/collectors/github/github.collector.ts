import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

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
 * Represents a GitHub user returned by the REST API.
 */
type GitHubUser = {
  login?: string;
};

/**
 * Represents a GitHub issue label.
 */
type GitHubLabel = {
  name?: string;
};

/**
 * Represents GitHub reaction totals.
 */
type GitHubReactions = {
  total_count?: number;
};

/**
 * Represents a GitHub issue returned by the search API.
 */
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

/**
 * Represents a GitHub issue comment.
 */
type GitHubComment = {
  id?: number;
  body?: string;
  created_at?: string;
  user?: GitHubUser;
  reactions?: GitHubReactions;
};

/**
 * Represents a GitHub issue search response.
 */
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
 * - Country, city, region, and language are stored as request metadata only.
 *
 * @author Malak
 */
@Injectable()
export class GitHubCollector extends BaseCollector implements SocialCollector {
  /**
   * Platform source type stored with collected records.
   */
  readonly sourceType = CollectionSourceType.GITHUB;

  /**
   * Human-readable platform name.
   */
  private readonly platformName = 'GitHub';

  /**
   * GitHub REST API base URL.
   */
  private readonly apiBaseUrl = 'https://api.github.com';

  constructor(configService: ConfigService) {
    super(configService, GitHubCollector.name);
  }

  /**
   * Collects GitHub issues, ranks them, and maps them
   * into the unified CollectorPost format.
   *
   * @param input Collection job configuration.
   * @returns Relevant GitHub issues and comments.
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
            timeout: 10_000,
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
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedIssues.map((item) =>
          this.mapIssueToCollectorPost(item.issue, input),
        ),
      );

      this.logger.log(`GitHub collection completed. Posts: ${posts.length}`);

      return posts;
    } catch (error: unknown) {
      this.logger.error(
        'GitHub collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'GitHub collection failed. Check GitHub token, collector limits, API limits, or network connection.',
      );
    }
  }

  /**
   * Builds a GitHub issue search query from
   * domain and user keywords.
   *
   * @param input Collection job configuration.
   * @returns GitHub search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    if (domainKeywords.length === 0) {
      return '';
    }

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const domainName = input.domainName
      ? this.normalizeText(input.domainName)
      : '';

    const terms = this.unique([domainName, ...domainKeywords, ...userQueries])
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
   * Validates a GitHub issue before ranking and mapping.
   *
   * @param issue GitHub issue.
   * @returns True when the issue is useful.
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
   *
   * @param issue GitHub issue.
   * @param input Collection job configuration.
   * @returns Relevance score.
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
   * Maps a GitHub issue to the unified
   * collector post format.
   *
   * @param issue GitHub issue.
   * @param input Collection job configuration.
   * @returns Unified collector post.
   */
  private async mapIssueToCollectorPost(
    issue: GitHubIssue,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectIssueComments(issue);

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
   *
   * @param issue GitHub issue.
   * @returns Useful GitHub comments.
   */
  private async collectIssueComments(
    issue: GitHubIssue,
  ): Promise<CollectorComment[]> {
    if (!issue.comments_url || !issue.comments) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build('github', 'comments', [
        issue.id,
      ]);

      const response = await CollectorHttpUtil.getWithRetryCacheAndHeaders<
        GitHubComment[]
      >(
        issue.comments_url,
        {
          headers: this.buildHeaders(),
          params: {
            per_page: Math.min(this.maxFetchedComments, 100),
          },
          timeout: 10_000,
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

      return data
        .filter((comment) => this.isUsefulComment(comment))
        .filter((comment) => {
          const id = comment.id?.toString();

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);

          return true;
        })
        .sort(
          (first, second) =>
            (second.reactions?.total_count ?? 0) -
            (first.reactions?.total_count ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: comment.id?.toString() ?? '',
            content: comment.body ?? '',
            author: comment.user?.login,
            likesCount: comment.reactions?.total_count ?? 0,
            publishedAt: comment.created_at
              ? new Date(comment.created_at)
              : undefined,
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `GitHub comments collection failed for issue ${String(
          issue.id ?? 'unknown',
        )}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Validates a GitHub comment before saving it.
   *
   * @param comment GitHub issue comment.
   * @returns True when the comment is useful.
   */
  private isUsefulComment(comment: GitHubComment): boolean {
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
   * Detects short operational comments that
   * do not help idea generation.
   *
   * @param content Comment content.
   * @returns True when the comment is low value.
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
   * Checks whether issue labels indicate
   * low-value collection data.
   *
   * @param labels Normalized issue labels.
   * @returns True when a blocked label exists.
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
   * Checks whether the issue title indicates
   * a discussion or maintenance task.
   *
   * @param title Normalized issue title.
   * @returns True when the title should be ignored.
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
   *
   * @param issue GitHub issue.
   * @returns True when the issue is a general discussion.
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
   *
   * @param issue GitHub issue.
   * @returns Normalized labels text.
   */
  private getIssueLabelsText(issue: GitHubIssue): string {
    return (issue.labels ?? [])
      .map((label) => this.normalizeText(label.name ?? ''))
      .join(' ');
  }

  /**
   * Logs a warning when GitHub remaining requests are low.
   *
   * @param headers GitHub response headers.
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
        ? new Date(reset * 1_000).toISOString()
        : 'unknown';

      this.logger.warn(
        `GitHub rate limit is low. Remaining: ${remaining}/${
          Number.isNaN(limit) || limit <= 0 ? 'unknown' : limit
        }. Reset: ${resetDate}`,
      );
    }
  }

  /**
   * Reads common blocked words and
   * GitHub-specific blocked words.
   *
   * @returns Normalized blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GITHUB_BLOCKED_WORDS');
  }

  /**
   * Builds GitHub REST API headers.
   *
   * @returns GitHub request headers.
   */
  private buildHeaders(): Record<string, string> {
    const token = this.configService.get<string>('GITHUB_TOKEN');

    return CollectorHeaderUtil.github(token);
  }

  /**
   * Extracts a readable message from unknown errors.
   *
   * @param error Unknown caught value.
   * @returns Safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown GitHub collector error.';
  }
}
