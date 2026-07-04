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
 * GitHub collector.
 *
 * Collects public GitHub issues and issue comments using GitHub REST API.
 *
 * Strategy:
 * - Uses domainKeywords from the database as the main search context.
 * - Uses problem words only to improve search queries and ranking.
 * - Does not reject issues only because they do not explicitly contain
 *   words like "problem" or "issue".
 * - Leaves deeper problem/need/sentiment detection to the NLP pipeline.
 *
 * Supports:
 * - Domain-based search.
 * - Optional user keywords.
 * - Filtering spam, jobs, bots, pull requests, and irrelevant content.
 * - Lightweight relevance ordering before storage limits.
 * - Deduplication inside the same collection run.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Centralized GitHub request headers through CollectorHeaderUtil.
 *
 * Notes:
 * - GitHub does not support real country/city filtering for public issues.
 * - country/city/region/language are stored as request metadata only.
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
   * Collects public GitHub issues and their useful comments.
   *
   * The method:
   * - Builds a GitHub search query from domain keywords and user keywords.
   * - Fetches issues from GitHub Search API.
   * - Filters invalid, duplicated, or irrelevant issues.
   * - Scores issues by relevance.
   * - Maps selected issues into the common CollectorPost format.
   *
   * @param input Collection request context.
   * @returns A list of normalized collector posts.
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

      const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
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
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const issues = data?.items ?? [];
      const seenIssueIds = new Set<string>();

      const rankedIssues = issues
        .filter((issue: any) => this.isValidIssue(issue))
        .filter((issue: any) => this.matchesInputContext(issue, input))
        .filter((issue: any) => {
          const id = issue?.id?.toString();

          if (!id || seenIssueIds.has(id)) {
            return false;
          }

          seenIssueIds.add(id);
          return true;
        })
        .map((issue: any) => ({
          issue,
          score: this.calculateIssueRelevanceScore(issue, input),
        }))
        .filter((item: any) => item.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const posts = await Promise.all(
        rankedIssues.map((item: any) =>
          this.mapIssueToCollectorPost(item.issue, input),
        ),
      );

      this.logger.log(`GitHub collection completed. Posts: ${posts.length}`);

      return posts;
    } catch (error: any) {
      this.logger.error(
        'GitHub collection failed',
        error.response?.data ?? error.message,
      );

      throw new ServiceUnavailableException(
        'GitHub collection failed. Check GitHub token, collector limits, API limits, or network connection.',
      );
    }
  }

  /**
   * Builds a GitHub issues search query using:
   * - Domain keywords.
   * - Optional user-provided keywords.
   * - Generated problem-related search queries.
   *
   * GitHub search qualifiers are added to:
   * - Search only issues.
   * - Exclude pull requests.
   * - Prefer issues with comments.
   * - Limit results to recently updated issues.
   *
   * @param input Collection request context.
   * @returns GitHub Search API query string.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    if (!domainKeywords.length) {
      return '';
    }

    const userQueries = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const terms = this.unique([
      ...userQueries,
      ...domainKeywords,
    ]).slice(0, 3);

    const searchTerms = terms.map((term) => `"${term}"`).join(' OR ');

    return [
      searchTerms,
      'is:issue',
      '-is:pr',
      'comments:>0',
      'updated:>2024-01-01',
    ].join(' ');
  }

  /**
   * Performs lightweight validation before mapping issues.
   *
   * Rejects:
   * - Missing issue IDs.
   * - Empty titles.
   * - Pull requests.
   * - Issues without comments.
   * - Bot authors.
   * - Job-related URLs.
   * - Content containing blocked words.
   *
   * @param issue Raw GitHub issue object.
   * @returns True if the issue is valid for collection.
   */
  private isValidIssue(issue: any): boolean {
    const title = issue?.title ?? '';
    const body = issue?.body ?? '';
    const author = issue?.user?.login ?? '';
    const url = issue?.html_url ?? '';
    const content = this.normalizeText(`${title} ${body}`);

    const blockedWords = this.getBlockedWords();

    return (
      Boolean(issue?.id) &&
      Boolean(title) &&
      !issue?.pull_request &&
      issue.comments > 0 &&
      !author.includes('[bot]') &&
      !url.includes('/jobs/') &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  /**
   * Checks whether the issue belongs to the selected domain/context.
   *
   * GitHub does not support reliable country, city, or region filtering,
   * so this method only validates textual relevance using domain and user keywords.
   *
   * @param issue Raw GitHub issue object.
   * @param input Collection request context.
   * @returns True if the issue text matches the requested context.
   */
  private matchesInputContext(issue: any, input: CollectorInput): boolean {
    const content = this.normalizeText(
      `${issue?.title ?? ''} ${issue?.body ?? ''}`,
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
   * The score considers:
   * - Title and body relevance.
   * - Domain keywords.
   * - Problem-related terms.
   * - Reactions count.
   * - Comments count.
   * - Publication date.
   *
   * @param issue Raw GitHub issue object.
   * @param input Collection request context.
   * @returns Numeric relevance score.
   */
  private calculateIssueRelevanceScore(
    issue: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: issue?.title ?? '',
      body: issue?.body ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: issue.reactions?.total_count ?? 0,
      replies: issue.comments ?? 0,
      publishedAt: issue.created_at ? new Date(issue.created_at) : undefined,
    });
  }

  /**
   * Maps a GitHub issue into the common CollectorPost format.
   *
   * Also collects useful issue comments and attaches them to the post.
   *
   * @param issue Raw GitHub issue object.
   * @param input Collection request context.
   * @returns Normalized collector post.
   */
  private async mapIssueToCollectorPost(
    issue: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectIssueComments(issue, input);

    return {
      sourceType: CollectionSourceType.GITHUB,
      platformName: this.platformName,
      externalId: issue.id.toString(),
      title: issue.title,
      content: issue.body ?? issue.title,
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
   * Collects and maps useful comments for a GitHub issue.
   *
   * The method:
   * - Skips issues without comments.
   * - Uses cache and retry support through CollectorHttpUtil.
   * - Removes duplicate comments inside the same run.
   * - Sorts comments by reaction count.
   * - Limits stored comments according to collector configuration.
   *
   * If comment collection fails, the issue is still kept without comments.
   *
   * @param issue Raw GitHub issue object.
   * @param input Collection request context.
   * @returns Normalized collector comments.
   */
  private async collectIssueComments(
    issue: any,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    if (!issue?.comments_url || !issue.comments) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build('github', 'comments', [
        issue.id,
      ]);

      const data = await CollectorHttpUtil.getWithRetryAndCache<any[]>(
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
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

      const seenCommentIds = new Set<string>();

      return (data ?? [])
        .filter((comment: any) => this.isUsefulComment(comment, input))
        .filter((comment: any) => {
          const id = comment?.id?.toString();

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);
          return true;
        })
        .sort(
          (a: any, b: any) =>
            (b.reactions?.total_count ?? 0) -
            (a.reactions?.total_count ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map((comment: any): CollectorComment => ({
          externalId: comment.id.toString(),
          content: comment.body,
          author: comment.user?.login,
          likesCount: comment.reactions?.total_count ?? 0,
          publishedAt: comment.created_at
            ? new Date(comment.created_at)
            : undefined,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Filters comments before storage.
   *
   * Rejects:
   * - Missing comment IDs.
   * - Very short comments.
   * - Bot authors.
   * - Blocked words.
   * - Comments unrelated to the selected domain/context.
   *
   * @param comment Raw GitHub issue comment object.
   * @param input Collection request context.
   * @returns True if the comment is useful for the NLP pipeline.
   */
  private isUsefulComment(comment: any, input: CollectorInput): boolean {
    const author = comment?.user?.login ?? '';
    const content = this.normalizeText(comment?.body ?? '');

    if (!comment?.id || content.length < 50 || author.includes('[bot]')) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    if (blockedWords.some((word) => content.includes(word))) {
      return false;
    }

    const domainKeywords = this.getDomainKeywords(input);
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const contextTerms = this.unique([...domainKeywords, ...userKeywords]);

    return contextTerms.some((term) => content.includes(term));
  }

  /**
   * Reads common blocked words and GitHub-specific blocked words.
   *
   * The environment variable GITHUB_BLOCKED_WORDS can be used
   * to add platform-specific blocked words without changing code.
   *
   * @returns A normalized list of blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('GITHUB_BLOCKED_WORDS');
  }

  /**
   * Builds GitHub request headers using the shared header utility.
   *
   * Keeps the previous behavior:
   * - Uses GitHub media type.
   * - Uses GitHub REST API version.
   * - Adds User-Agent.
   * - Adds Authorization only when GITHUB_TOKEN exists.
   *
   * @returns GitHub API request headers.
   */
  private buildHeaders(): Record<string, string> {
    const token = this.configService.get<string>('GITHUB_TOKEN');

    return CollectorHeaderUtil.github(token);
  }
}