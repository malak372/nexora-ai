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
 * Represents a GitHub issue-search response.
 */
type GitHubSearchResponse = {
  items?: GitHubIssue[];
};

/**
 * GitHub collector.
 *
 * Collects public GitHub issues and issue comments using
 * the GitHub REST API.
 *
 * The sourceKey must match DataSource.key in the database.
 *
 * @author Malak
 */
@Injectable()
export class GitHubCollector extends BaseCollector implements SocialCollector {
  /**
   * Stable data-source key.
   *
   * Must match:
   * DataSource.key = "github"
   */
  readonly sourceKey = 'github';

  /**
   * GitHub REST API base URL.
   */
  private readonly apiBaseUrl = 'https://api.github.com';

  constructor(configService: ConfigService) {
    super(configService, GitHubCollector.name);
  }

  /**
   * Collects GitHub issues, ranks them, and attaches
   * useful issue comments.
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

      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'issues', [
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
   * Builds a GitHub issue-search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    if (domainKeywords.length === 0) {
      return '';
    }

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const domainName = this.cleanNormalizedText(input.domainName);

    const terms = this.unique([domainName, ...domainKeywords, ...userQueries])
      .filter((term) => term.length >= 3)
      .slice(0, 5);

    if (!terms.length) {
      return '';
    }

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
   * Validates a GitHub issue before ranking.
   */
  private isValidIssue(issue: GitHubIssue): boolean {
    const title = this.cleanPlainText(issue.title);
    const body = this.cleanPlainText(issue.body);
    const author = this.cleanNormalizedText(issue.user?.login);
    const url = issue.html_url ?? '';

    const normalizedTitle = this.cleanNormalizedText(title);
    const content = this.cleanNormalizedText(`${title} ${body}`);
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

    if (
      blockedWords.some((word) =>
        content.includes(this.cleanNormalizedText(word)),
      )
    ) {
      return false;
    }

    if (this.hasBlockedIssueLabel(labels)) {
      return false;
    }

    if (this.isGeneralDiscussionIssue(issue)) {
      return false;
    }

    return !this.hasIgnoredIssueTitle(normalizedTitle);
  }

  /**
   * Calculates issue relevance.
   */
  private calculateIssueRelevanceScore(
    issue: GitHubIssue,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(issue.title),
      body: this.cleanPlainText(issue.body),
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: issue.reactions?.total_count ?? 0,
      replies: issue.comments ?? 0,
      publishedAt: this.parseDate(issue.created_at),
    });
  }

  /**
   * Maps a GitHub issue to CollectorPost.
   */
  private async mapIssueToCollectorPost(
    issue: GitHubIssue,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectIssueComments(issue);

    const title = this.cleanPlainText(issue.title);
    const body = this.cleanPlainText(issue.body);

    return {
      externalId: issue.id?.toString() ?? '',
      title,
      content: body || title,
      author: this.cleanPlainText(issue.user?.login),
      url: issue.html_url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: issue.reactions?.total_count ?? 0,
      repliesCount: issue.comments ?? comments.length,
      publishedAt: this.parseDate(issue.created_at),

      comments,
    };
  }

  /**
   * Collects useful comments for a GitHub issue.
   */
  private async collectIssueComments(
    issue: GitHubIssue,
  ): Promise<CollectorComment[]> {
    if (!issue.comments_url || !issue.comments) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'comments', [
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

      const seenCommentIds = new Set<string>();

      return response.data
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
            content: this.cleanPlainText(comment.body),
            author: this.cleanPlainText(comment.user?.login),
            likesCount: comment.reactions?.total_count ?? 0,
            publishedAt: this.parseDate(comment.created_at),
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
   * Validates a GitHub issue comment.
   */
  private isUsefulComment(comment: GitHubComment): boolean {
    const author = this.cleanNormalizedText(comment.user?.login);
    const rawContent = this.cleanPlainText(comment.body);
    const content = this.cleanNormalizedText(rawContent);

    if (!comment.id || content.length < 50 || author.includes('[bot]')) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s+]/gu, '').trim();

    if (!cleaned || this.isLowValueComment(rawContent)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Detects operational or low-value comments.
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
   * Checks blocked GitHub issue labels.
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

    return blockedLabels.some((label) => labels.includes(label));
  }

  /**
   * Checks ignored issue-title terms.
   */
  private hasIgnoredIssueTitle(title: string): boolean {
    const ignoredTerms = [
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

    return ignoredTerms.some((term) => title.includes(term));
  }

  /**
   * Detects general discussion issues.
   */
  private isGeneralDiscussionIssue(issue: GitHubIssue): boolean {
    const title = this.cleanNormalizedText(issue.title);
    const labels = this.getIssueLabelsText(issue);
    const text = `${title} ${labels}`;

    const terms = [
      'general discussion',
      'discussion',
      'chat',
      'random',
      'off topic',
      'off-topic',
      'announcement',
      'show and tell',
    ];

    return terms.some((term) => text.includes(term));
  }

  /**
   * Converts issue labels to normalized text.
   */
  private getIssueLabelsText(issue: GitHubIssue): string {
    return (issue.labels ?? [])
      .map((label) => this.cleanNormalizedText(label.name))
      .join(' ');
  }

  /**
   * Logs GitHub rate-limit warnings.
   */
  private monitorGitHubRateLimit(headers: Record<string, unknown>): void {
    const remaining = Number(headers['x-ratelimit-remaining']);
    const limit = Number(headers['x-ratelimit-limit']);
    const reset = Number(headers['x-ratelimit-reset']);

    if (Number.isNaN(remaining)) {
      return;
    }

    if (remaining <= 10) {
      const resetDate =
        Number.isFinite(reset) && reset > 0
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
   * Reads common and GitHub-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GITHUB_BLOCKED_WORDS');
  }

  /**
   * Builds GitHub API headers.
   */
  private buildHeaders(): Record<string, string> {
    const token = this.configService.get<string>('GITHUB_TOKEN');

    return CollectorHeaderUtil.github(token);
  }

  /**
   * Parses an optional external date.
   */
  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

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
      : 'Unknown GitHub collector error.';
  }
}
