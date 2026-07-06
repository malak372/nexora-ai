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

import { RelevanceScoreUtil } from '../base/relevance-score.util';

type ProductHuntUser = {
  name?: string;
  username?: string;
};

type ProductHuntPost = {
  id?: string;
  name?: string;
  tagline?: string;
  description?: string;
  url?: string;
  votesCount?: number;
  commentsCount?: number;
  createdAt?: string;
  user?: ProductHuntUser;
};

type ProductHuntComment = {
  id?: string;
  body?: string;
  createdAt?: string;
  user?: ProductHuntUser;
};

type ProductHuntEdge<T> = {
  node: T;
};

type ProductHuntPostsResponse = {
  data?: {
    posts?: {
      pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string;
      };
      edges?: Array<ProductHuntEdge<ProductHuntPost>>;
    };
  };
  errors?: unknown[];
};

type ProductHuntCommentsResponse = {
  data?: {
    post?: {
      comments?: {
        edges?: Array<ProductHuntEdge<ProductHuntComment>>;
      };
    };
  };
  errors?: unknown[];
};

/**
 * Product Hunt collector.
 *
 * Collects public Product Hunt posts and comments using
 * Product Hunt GraphQL API.
 *
 * Notes:
 * - Requires PRODUCT_HUNT_TOKEN.
 * - Uses pagination to collect posts.
 * - Filters posts locally based on user/domain keywords.
 * - Adds small delays between requests to reduce rate-limit risk.
 *
 * @author Malak
 */
@Injectable()
export class ProductHuntCollector
  extends BaseCollector
  implements SocialCollector
{
  readonly sourceType = CollectionSourceType.PRODUCT_HUNT;

  private readonly platformName = 'Product Hunt';
  private readonly apiUrl = 'https://api.producthunt.com/v2/api/graphql';

  private readonly pageSize = 20;
  private readonly commentsPageSize = 10;
  private readonly requestDelayMs = 500;

  constructor(configService: ConfigService) {
    super(configService, ProductHuntCollector.name);
  }

  /**
   * Collects Product Hunt posts, filters them by input,
   * ranks them by relevance, and maps them to CollectorPost format.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const token = this.getToken();
      const searchTerms = this.buildSearchTerms(input);

      if (!token) {
        this.logger.warn(
          'Product Hunt collection skipped because PRODUCT_HUNT_TOKEN is missing.',
        );
        return [];
      }

      if (!searchTerms.length) {
        this.logger.warn(
          'Product Hunt collection skipped because no search keywords exist.',
        );
        return [];
      }

      const rawPosts = await this.collectPostsByPagination(token);
      const filteredPosts = this.filterPostsByInput(rawPosts, input, searchTerms);

      const seenPostIds = new Set<string>();

      const rankedPosts = filteredPosts
        .filter((post) => this.isValidPost(post))
        .filter((post) => {
          const id = post.id?.toString();

          if (!id || seenPostIds.has(id)) return false;

          seenPostIds.add(id);
          return true;
        })
        .map((post) => ({
          post,
          score: this.calculatePostRelevanceScore(post, input),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts);

      const result: CollectorPost[] = [];

      for (const item of rankedPosts) {
        const mappedPost = await this.mapProductToCollectorPost(
          item.post,
          input,
          token,
        );

        result.push(mappedPost);
        await this.delay(this.requestDelayMs);
      }

      this.logger.log(
        `Product Hunt collection completed. Posts: ${result.length}`,
      );

      return result;
    } catch (error: unknown) {
      this.logger.error(
        'Product Hunt collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'Product Hunt collection failed. Check PRODUCT_HUNT_TOKEN, API limits, or network connection.',
      );
    }
  }

  /**
   * Collects Product Hunt posts using cursor-based pagination.
   */
  private async collectPostsByPagination(
    token: string,
  ): Promise<ProductHuntPost[]> {
    const query = `
      query GetPosts($first: Int!, $after: String) {
        posts(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              tagline
              description
              url
              votesCount
              commentsCount
              createdAt
              user {
                name
                username
              }
            }
          }
        }
      }
    `;

    const collectedPosts: ProductHuntPost[] = [];
    let after: string | null = null;

    while (collectedPosts.length < this.maxFetchedPosts) {
      const data = await this.graphqlRequest<ProductHuntPostsResponse>(
        query,
        {
          first: this.pageSize,
          after,
        },
        token,
      );

      const edges = data.data?.posts?.edges ?? [];
      const pageInfo = data.data?.posts?.pageInfo;

      const posts = edges.map((edge) => edge.node);
      collectedPosts.push(...posts);

      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
        break;
      }

      after = pageInfo.endCursor;

      await this.delay(this.requestDelayMs);
    }

    return collectedPosts.slice(0, this.maxFetchedPosts);
  }

  /**
   * Filters posts according to user keywords, domain name, and domain keywords.
   */
  private filterPostsByInput(
    posts: ProductHuntPost[],
    input: CollectorInput,
    searchTerms: string[],
  ): ProductHuntPost[] {
    const normalizedTerms = searchTerms.map((term) => this.normalizeText(term));

    const domainKeywords = this.getDomainKeywords(input).map((keyword) =>
      this.normalizeText(keyword),
    );

    const allTerms = this.unique([...normalizedTerms, ...domainKeywords]);

    return posts.filter((post) => {
      const content = this.normalizeText(
        `${post.name ?? ''} ${post.tagline ?? ''} ${post.description ?? ''}`,
      );

      return allTerms.some((term) => content.includes(term));
    });
  }

  /**
   * Collects public comments for a Product Hunt post.
   */
  private async collectProductComments(
    postId: string,
    token: string,
  ): Promise<CollectorComment[]> {
    const query = `
      query GetPostComments($id: ID!, $first: Int!) {
        post(id: $id) {
          comments(first: $first) {
            edges {
              node {
                id
                body
                createdAt
                user {
                  name
                  username
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphqlRequest<ProductHuntCommentsResponse>(
      query,
      {
        id: postId,
        first: this.commentsPageSize,
      },
      token,
    );

    const edges = data.data?.post?.comments?.edges ?? [];

    return edges
      .map((edge) => edge.node)
      .filter((comment) => this.isUsefulComment(comment))
      .slice(0, this.maxSavedComments)
      .map((comment): CollectorComment => ({
        externalId: comment.id?.toString() ?? `${postId}-${comment.createdAt}`,
        content: this.cleanHtml(comment.body),
        author: comment.user?.username ?? comment.user?.name,
        likesCount: 0,
        publishedAt: comment.createdAt
          ? new Date(comment.createdAt)
          : undefined,
      }));
  }

  /**
   * Sends a GraphQL request to Product Hunt API.
   */
  private async graphqlRequest<T>(
    query: string,
    variables: Record<string, unknown>,
    token: string,
  ): Promise<T> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`Product Hunt API failed with status ${response.status}`);
    }

    const data = (await response.json()) as T & { errors?: unknown[] };

    if (data.errors?.length) {
      this.logger.warn(
        `Product Hunt GraphQL errors: ${JSON.stringify(data.errors)}`,
      );

      return {} as T;
    }

    return data;
  }

  /**
   * Builds search terms from user keywords, domain keywords, and domain name.
   */
  private buildSearchTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ])
      .filter((term) => term.length >= 2)
      .slice(0, 10);
  }

  /**
   * Validates Product Hunt post before ranking and mapping.
   */
  private isValidPost(post: ProductHuntPost): boolean {
    const title = post.name ?? '';
    const body = `${post.tagline ?? ''} ${post.description ?? ''}`;
    const content = this.normalizeText(`${title} ${body}`);
    const blockedWords = this.getBlockedWords();

    if (!post.id || !title || content.length < 20) {
      return false;
    }

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Calculates relevance score using shared scoring utility.
   */
  private calculatePostRelevanceScore(
    post: ProductHuntPost,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post.name ?? '',
      body: `${post.tagline ?? ''} ${post.description ?? ''}`,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.votesCount ?? 0,
      replies: post.commentsCount ?? 0,
      publishedAt: post.createdAt ? new Date(post.createdAt) : undefined,
    });
  }

  /**
   * Maps Product Hunt post to the unified CollectorPost format.
   */
  private async mapProductToCollectorPost(
    post: ProductHuntPost,
    input: CollectorInput,
    token: string,
  ): Promise<CollectorPost> {
    const postId = post.id?.toString() ?? '';
    const comments = await this.collectProductComments(postId, token);

    return {
      sourceType: CollectionSourceType.PRODUCT_HUNT,
      platformName: this.platformName,
      externalId: postId,
      title: post.name,
      content: this.cleanHtml(
        [post.tagline, post.description].filter(Boolean).join('\n\n'),
      ),
      author: post.user?.username ?? post.user?.name,
      url: post.url,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: post.votesCount ?? 0,
      repliesCount: post.commentsCount ?? comments.length,
      publishedAt: post.createdAt ? new Date(post.createdAt) : undefined,
      comments,
    };
  }

  /**
   * Filters short, empty, or blocked comments.
   */
  private isUsefulComment(comment: ProductHuntComment): boolean {
    const content = this.normalizeText(this.cleanHtml(comment.body));

    if (!comment.id || content.length < 10) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Reads Product Hunt token from environment variables.
   */
  private getToken(): string {
    return this.configService.get<string>('PRODUCT_HUNT_TOKEN') ?? '';
  }

  /**
   * Reads common blocked words and Product Hunt-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('PRODUCT_HUNT_BLOCKED_WORDS');
  }

  /**
   * Builds Product Hunt API headers.
   */
  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }

  /**
   * Removes HTML tags and decodes common HTML entities.
   */
  private cleanHtml(text?: string): string {
    return (text ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts a readable error message from unknown errors.
   */
  private getErrorMessage(error: unknown): unknown {
    if (error instanceof Error) {
      return error.message;
    }

    return error;
  }

  /**
   * Adds a delay between API requests.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}