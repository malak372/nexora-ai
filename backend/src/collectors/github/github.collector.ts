import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';
import axios from 'axios';

import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

/**
 * GitHub collector.
 *
 * Collects public GitHub issues and issue comments using GitHub REST API.
 *
 * Strategy:
 * - User selects a domain, not a problem.
 * - Collector uses domain keywords to discover possible problems.
 * - User keywords are optional advanced filters.
 * - GitHub does not support real country/city/region filtering.
 *
 * @author Malak
 */
@Injectable()
export class GitHubCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.GITHUB;

  private readonly platformName = 'GitHub';
  private readonly apiBaseUrl = 'https://api.github.com';

  private readonly maxFetchedIssues = 50;
  private readonly maxSavedPosts = 10;
  private readonly maxCommentsPerPost = 10;

  constructor(private readonly configService: ConfigService) { }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/search/issues`, {
        headers: this.buildHeaders(),
        params: {
          q: this.buildSearchQuery(input),
          sort: 'updated',
          order: 'desc',
          per_page: this.maxFetchedIssues,
        },
        timeout: 10000,
      });

      const issues = response.data?.items ?? [];

      const filteredIssues = issues
        .filter((issue: any) => this.isValidIssue(issue))
        .filter((issue: any) => this.matchesInputContext(issue, input))
        .slice(0, this.maxSavedPosts);

      return Promise.all(
        filteredIssues.map((issue: any) =>
          this.mapIssueToCollectorPost(issue, input),
        ),
      );
    } catch {
      throw new ServiceUnavailableException(
        'GitHub collection failed. Check GitHub token, API limits, or network connection.',
      );
    }
  }

  private buildSearchQuery(input: CollectorInput): string {
    const terms = this.getSearchTerms(input).slice(0, 6);

    const searchTerms =
      terms.length > 0 ? terms.join(' OR ') : 'software OR app OR feature OR bug';

    return [
      searchTerms,
      'is:issue',
      '-is:pr',
      'comments:>0',
      'updated:>2024-01-01',
    ].join(' ');
  }

  private getSearchTerms(input: CollectorInput): string[] {
    const domainTerms =
      input.domainKeywords?.length
        ? input.domainKeywords
        : this.getFallbackDomainTerms(input.domainName);

    return [...domainTerms, ...(input.keywords ?? [])]
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
  }

  private getFallbackDomainTerms(domainName?: string): string[] {
    const domain = domainName?.toLowerCase();

    const dictionary: Record<string, string[]> = {
      education: [
        'education',
        'student',
        'school',
        'teacher',
        'learning',
        'course',
        'assignment',
        'exam',
        'classroom',
        'lms',
      ],
      healthcare: [
        'healthcare',
        'patient',
        'clinic',
        'hospital',
        'doctor',
        'appointment',
        'medical',
        'health',
      ],
      finance: [
        'finance',
        'payment',
        'banking',
        'wallet',
        'invoice',
        'transaction',
        'budget',
      ],
      agriculture: [
        'agriculture',
        'farm',
        'crop',
        'irrigation',
        'soil',
        'harvest',
      ],
      tourism: [
        'tourism',
        'travel',
        'booking',
        'hotel',
        'tourist',
        'trip',
      ],
      'e-commerce': [
        'ecommerce',
        'e-commerce',
        'cart',
        'checkout',
        'order',
        'payment',
        'delivery',
      ],
      cybersecurity: [
        'cybersecurity',
        'security',
        'vulnerability',
        'authentication',
        'privacy',
        'threat',
      ],
      'artificial intelligence': [
        'ai',
        'artificial intelligence',
        'machine learning',
        'model',
        'automation',
      ],
      'legal technology': [
        'legal',
        'law',
        'contract',
        'compliance',
        'regulation',
        'case management',
      ],
      other: ['software', 'app', 'platform', 'feature', 'bug', 'problem'],
    };

    return dictionary[domain ?? ''] ?? (domainName ? [domainName] : []);
  }

  private isValidIssue(issue: any): boolean {
    const title = issue?.title ?? '';
    const body = issue?.body ?? '';
    const author = issue?.user?.login ?? '';
    const url = issue?.html_url ?? '';
    const content = `${title} ${body}`.toLowerCase();

    const blockedWords = [
      'screenplay',
      'fiction',
      'roleplay',
      'we are hiring',
      "we're hiring",
      'hiring',
      'job',
      'jobs',
      'career',
      'employment',
      'team status',
      'status report',
      'ai-generated content',
      '/claim',
      'assigned!',
      'auto-assigned',
      'stale assignment cleanup',
    ];

    return (
      issue?.id &&
      title &&
      !issue?.pull_request &&
      issue.comments > 0 &&
      !author.includes('[bot]') &&
      !url.includes('/jobs/') &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  private matchesInputContext(issue: any, input: CollectorInput): boolean {
    const title = issue?.title ?? '';
    const body = issue?.body ?? '';
    const content = `${title} ${body}`.toLowerCase();

    const terms = this.getSearchTerms(input);

    const matchedTermsCount = terms.filter((term) =>
      content.includes(term),
    ).length;

    return matchedTermsCount >= 2;
  }

  private async mapIssueToCollectorPost(
    issue: any,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const comments = await this.collectIssueComments(issue);

    return {
      sourceType: CollectionSourceType.GITHUB,
      platformName: this.platformName,
      externalId: issue.id.toString(),
      title: issue.title,
      content: issue.body ?? issue.title,
      author: issue.user?.login,
      url: issue.html_url,

      // Metadata from user request, not real GitHub location.
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

  private async collectIssueComments(issue: any): Promise<CollectorComment[]> {
    if (!issue?.comments_url || !issue.comments) {
      return [];
    }

    try {
      const response = await axios.get(issue.comments_url, {
        headers: this.buildHeaders(),
        params: {
          per_page: this.maxCommentsPerPost,
        },
        timeout: 10000,
      });

      const comments = response.data ?? [];

      return comments
        .filter((comment: any) => this.isUsefulComment(comment))
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

  private isUsefulComment(comment: any): boolean {
    const author = comment?.user?.login ?? '';
    const content = (comment?.body ?? '').trim().toLowerCase();

    return (
      comment?.id &&
      content.length >= 40 &&
      !author.includes('[bot]') &&
      !content.startsWith('/claim') &&
      !content.startsWith('/assign') &&
      !content.includes('assigned!') &&
      !content.includes('auto-assigned') &&
      !content.includes('stale assignment cleanup')
    );
  }

  private buildHeaders(): Record<string, string> {
    const token = this.configService.get<string>('GITHUB_TOKEN');

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NexoraAI-Graduation-Project',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }
}