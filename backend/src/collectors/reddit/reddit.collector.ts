import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';
import axios from 'axios';

import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

/**
 * Reddit public JSON collector.
 *
 * Collects public Reddit posts and comments using Reddit JSON endpoints.
 *
 * Strategy:
 * - Uses domain keywords as the main discovery source.
 * - Uses user keywords as optional filters.
 * - Searches globally and inside relevant subreddits.
 * - Removes deleted, removed, promotional, and low-quality content.
 * - Does not fail the full pipeline if Reddit blocks or rate-limits requests.
 *
 * Limitations:
 * - Does not use Reddit OAuth.
 * - Works only with public Reddit content.
 * - Reddit public JSON endpoints can return 0 results or rate-limit requests.
 * - Reddit does not provide accurate country/city/region filtering.
 *
 * @author Malak
 */
@Injectable()
export class RedditCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.REDDIT;

  private readonly platformName = 'Reddit';
  private readonly baseUrl = 'https://old.reddit.com';
  private readonly userAgent =
    process.env.REDDIT_USER_AGENT ??
    'NexoraAI:graduation-project:v1.0.0 (by /u/Master-Food8668)';

  private readonly maxPosts = 10;
  private readonly maxCommentsPerPost = 10;
  private readonly requestTimeoutMs = 15000;

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const collectedPosts = new Map<string, CollectorPost>();

    const searchUrls = this.buildSearchUrls(input);

    console.log('SEARCH URLS');
    console.log(searchUrls);

    for (const url of searchUrls) {
      const posts = await this.collectFromUrl(url, input);

      for (const post of posts) {
        if (collectedPosts.size >= this.maxPosts) {
          break;
        }

        collectedPosts.set(post.externalId, post);
      }

      if (collectedPosts.size >= this.maxPosts) {
        break;
      }

      await this.delay(700);
    }

    return Array.from(collectedPosts.values());
  }

  private async collectFromUrl(
    url: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    console.log('TRY REDDIT URL:', url);

    try {
      const response = await axios.get(url, {
        headers: this.buildHeaders(),
        timeout: this.requestTimeoutMs,
        validateStatus: () => true,
      });

      console.log('REDDIT STATUS:', response.status);

      const children = response.data?.data?.children ?? [];

      console.log('REDDIT CHILDREN:', children.length);

      const posts: CollectorPost[] = [];

      for (const child of children) {
        const redditPost = child?.data;

        console.log('POST TITLE:', redditPost?.title);

        if (!this.isValidPost(redditPost)) {
          console.log('Rejected by isValidPost');
          continue;
        }

        if (!this.matchesInputContext(redditPost, input)) {
          console.log('Rejected by matchesInputContext');
          continue;
        }

        const comments = await this.collectPostComments(
          redditPost.permalink,
          input.language,
        );

        posts.push({
          sourceType: CollectionSourceType.REDDIT,
          platformName: this.platformName,
          externalId: redditPost.id,
          title: redditPost.title,
          content: this.buildPostContent(redditPost),
          author: redditPost.author,
          url: `${this.baseUrl}${redditPost.permalink}`,
          country: input.country,
          city: input.city,
          region: input.region,
          language: input.language,
          likesCount: redditPost.ups ?? redditPost.score ?? 0,
          repliesCount: redditPost.num_comments ?? comments.length,
          publishedAt: redditPost.created_utc
            ? new Date(redditPost.created_utc * 1000)
            : undefined,
          comments,
        });
      }

      return posts;
    } catch (error: any) {
      console.log('REDDIT FAILED URL:', url);
      console.log('REDDIT ERROR STATUS:', error?.response?.status);
      console.log('REDDIT ERROR MESSAGE:', error?.message);
      return [];
    }
  }
  private async collectPostComments(
    permalink: string,
    language?: string,
  ): Promise<CollectorComment[]> {
    const commentsUrl = `${this.baseUrl}${permalink}.json?limit=${this.maxCommentsPerPost}`;

    try {
      const response = await axios.get(commentsUrl, {
        headers: this.buildHeaders(),
        timeout: this.requestTimeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const commentChildren = response.data?.[1]?.data?.children ?? [];

      return commentChildren
        .map((child: any) => child?.data)
        .filter((comment: any) => this.isValidComment(comment))
        .slice(0, this.maxCommentsPerPost)
        .map((comment: any): CollectorComment => ({
          externalId: comment.id,
          content: comment.body,
          author: comment.author,
          language,
          likesCount: comment.ups ?? comment.score ?? 0,
          publishedAt: comment.created_utc
            ? new Date(comment.created_utc * 1000)
            : undefined,
        }));
    } catch {
      return [];
    }
  }

  private buildSearchUrls(input: CollectorInput): string[] {
    const query = this.buildSearchQuery(input);
    const encodedQuery = encodeURIComponent(query);

    const urls: string[] = [
      `${this.baseUrl}/search.json?q=${encodedQuery}&sort=relevance&limit=${this.maxPosts}`,
    ];

    for (const subreddit of this.getSubredditsForDomain(input.domainName)) {
      urls.push(
        `${this.baseUrl}/r/${subreddit}/search.json?q=${encodedQuery}&restrict_sr=1&sort=relevance&limit=${this.maxPosts}`,
      );
    }

    return urls;
  }

  private buildSearchQuery(input: CollectorInput): string {
    const terms = this.getSearchTerms(input).slice(0, 2);

    return terms.length > 0
      ? terms.join(' OR ')
      : 'software OR app OR problem';
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
        'exam',
        'homework',
        'classroom',
        'edtech',
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
        'privacy',
        'authentication',
        'vulnerability',
        'threat',
      ],
      'artificial intelligence': [
        'ai',
        'artificial intelligence',
        'machine learning',
        'automation',
        'model',
      ],
      other: ['software', 'app', 'platform', 'feature', 'bug', 'problem'],
    };

    return dictionary[domain ?? ''] ?? (domainName ? [domainName] : []);
  }

  private getSubredditsForDomain(domainName?: string): string[] {
    const domain = domainName?.toLowerCase();

    const dictionary: Record<string, string[]> = {
      education: [
        'education',
        'Teachers',
        'college',
        'students',
        'edtech',
        'AskAcademia',
      ],
      healthcare: ['healthcare', 'medicine', 'HealthIT'],
      finance: ['personalfinance', 'fintech', 'banking'],
      agriculture: ['farming', 'Agriculture'],
      tourism: ['travel', 'solotravel'],
      'e-commerce': ['ecommerce', 'shopify', 'smallbusiness'],
      cybersecurity: ['cybersecurity', 'netsec', 'privacy'],
      'artificial intelligence': [
        'ArtificialInteligence',
        'MachineLearning',
        'LocalLLaMA',
      ],
      other: ['technology', 'software', 'programming'],
    };

    return dictionary[domain ?? ''] ?? ['technology', 'software', 'programming'];
  }

  private matchesInputContext(post: any, input: CollectorInput): boolean {
    const content = [post?.title, post?.selftext, post?.subreddit]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const userKeywords = input.keywords ?? [];

    if (!userKeywords.length) {
      return true;
    }

    return userKeywords.some((term) =>
      content.includes(term.trim().toLowerCase()),
    );
  }

  private isValidPost(post: any): boolean {
    const title = post?.title ?? '';
    const body = post?.selftext ?? '';
    const author = post?.author ?? '';
    const content = `${title} ${body}`.toLowerCase();

    const blockedWords = [
      '[deleted]',
      '[removed]',
      'hiring',
      'job',
      'jobs',
      'career',
      'advertisement',
      'promo',
      'giveaway',
      'self promotion',
      'nsfw',
    ];

    return (
      post?.id &&
      post?.title &&
      post?.permalink &&
      author !== '[deleted]' &&
      post.removed_by_category == null &&
      post.over_18 !== true &&
      !blockedWords.some((word) => content.includes(word))
    );
  }

  private isValidComment(comment: any): boolean {
    const author = comment?.author ?? '';
    const content = (comment?.body ?? '').trim().toLowerCase();

    return (
      comment?.id &&
      content.length >= 20 &&
      content !== '[deleted]' &&
      content !== '[removed]' &&
      author !== '[deleted]'
    );
  }

  private buildPostContent(post: any): string {
    return [post.title, post.selftext].filter(Boolean).join('\n\n');
  }

  private buildHeaders(): Record<string, string> {
    return {
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}