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

/**
 * Represents a Product Hunt user.
 */
type ProductHuntUser = {
  name?: string;
  username?: string;
};

/**
 * Represents a Product Hunt post returned by
 * the Product Hunt GraphQL API.
 */
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

/**
 * Represents a Product Hunt comment returned by
 * the Product Hunt GraphQL API.
 */
type ProductHuntComment = {
  id?: string;
  body?: string;
  createdAt?: string;
  user?: ProductHuntUser;
};

/**
 * Represents one node edge in a GraphQL connection.
 *
 * @template T GraphQL node type.
 */
type ProductHuntEdge<T> = {
  node: T;
};

/**
 * Represents cursor-based pagination information.
 */
type ProductHuntPageInfo = {
  hasNextPage?: boolean;
  endCursor?: string;
};

/**
 * Represents the Product Hunt posts GraphQL response.
 */
type ProductHuntPostsResponse = {
  data?: {
    posts?: {
      pageInfo?: ProductHuntPageInfo;
      edges?: Array<ProductHuntEdge<ProductHuntPost>>;
    };
  };
  errors?: unknown[];
};

/**
 * Represents the Product Hunt comments GraphQL response.
 */
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
 * Runtime validator used to safely narrow unknown
 * GraphQL responses.
 *
 * @template T Expected response type.
 */
type GraphqlResponseValidator<T> = (value: unknown) => value is T;

/**
 * Product Hunt collector.
 *
 * Collects public Product Hunt posts and comments using
 * the Product Hunt GraphQL API.
 *
 * Notes:
 * - Requires PRODUCT_HUNT_TOKEN.
 * - Uses cursor-based pagination to collect posts.
 * - Filters posts locally using user and domain keywords.
 * - Adds small delays between requests to reduce rate-limit risk.
 * - Validates unknown GraphQL responses before using them.
 *
 * @author Malak
 */
@Injectable()
export class ProductHuntCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Platform source type stored with collected records.
   */
  readonly sourceType = CollectionSourceType.PRODUCT_HUNT;

  /**
   * Human-readable platform name.
   */
  private readonly platformName = 'Product Hunt';

  /**
   * Product Hunt GraphQL API endpoint.
   */
  private readonly apiUrl = 'https://api.producthunt.com/v2/api/graphql';

  /**
   * Number of posts requested per GraphQL page.
   */
  private readonly pageSize = 20;

  /**
   * Maximum number of comments requested per post.
   */
  private readonly commentsPageSize = 10;

  /**
   * Delay between Product Hunt API requests.
   */
  private readonly requestDelayMs = 500;

  constructor(configService: ConfigService) {
    super(configService, ProductHuntCollector.name);
  }

  /**
   * Collects Product Hunt posts, filters them using
   * the collection input, ranks them by relevance,
   * and maps them to the unified collector format.
   *
   * @param input Collection job configuration.
   * @returns Relevant Product Hunt posts and comments.
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

      if (searchTerms.length === 0) {
        this.logger.warn(
          'Product Hunt collection skipped because no search keywords exist.',
        );

        return [];
      }

      const rawPosts = await this.collectPostsByPagination(token);

      const filteredPosts = this.filterPostsByInput(
        rawPosts,
        input,
        searchTerms,
      );

      const seenPostIds = new Set<string>();

      const rankedPosts = filteredPosts
        .filter((post) => this.isValidPost(post))
        .filter((post) => {
          const postId = post.id;

          if (!postId || seenPostIds.has(postId)) {
            return false;
          }

          seenPostIds.add(postId);

          return true;
        })
        .map((post) => ({
          post,
          score: this.calculatePostRelevanceScore(post, input),
        }))
        .sort((first, second) => second.score - first.score)
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
   *
   * @param token Product Hunt API access token.
   * @returns Collected Product Hunt posts.
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
      const response: ProductHuntPostsResponse = await this.graphqlRequest(
        query,
        {
          first: this.pageSize,
          after,
        },
        token,
        (value: unknown): value is ProductHuntPostsResponse =>
          this.isProductHuntPostsResponse(value),
      );

      const postsConnection = response.data?.posts;

      const edges: Array<ProductHuntEdge<ProductHuntPost>> =
        postsConnection?.edges ?? [];

      const pageInfo: ProductHuntPageInfo | undefined =
        postsConnection?.pageInfo;

      const posts: ProductHuntPost[] = edges.map(
        (edge: ProductHuntEdge<ProductHuntPost>): ProductHuntPost => edge.node,
      );

      collectedPosts.push(...posts);

      if (pageInfo?.hasNextPage !== true || !pageInfo.endCursor) {
        break;
      }

      after = pageInfo.endCursor;

      await this.delay(this.requestDelayMs);
    }

    return collectedPosts.slice(0, this.maxFetchedPosts);
  }

  /**
   * Filters posts according to user keywords,
   * domain name, and domain keywords.
   *
   * @param posts Product Hunt posts.
   * @param input Collection job configuration.
   * @param searchTerms Prepared search terms.
   * @returns Matching Product Hunt posts.
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
   * Collects public comments for one Product Hunt post.
   *
   * @param postId Product Hunt post identifier.
   * @param token Product Hunt API access token.
   * @returns Useful Product Hunt comments.
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

    const response: ProductHuntCommentsResponse = await this.graphqlRequest(
      query,
      {
        id: postId,
        first: this.commentsPageSize,
      },
      token,
      (value: unknown): value is ProductHuntCommentsResponse =>
        this.isProductHuntCommentsResponse(value),
    );

    const edges: Array<ProductHuntEdge<ProductHuntComment>> =
      response.data?.post?.comments?.edges ?? [];

    return edges
      .map(
        (edge: ProductHuntEdge<ProductHuntComment>): ProductHuntComment =>
          edge.node,
      )
      .filter((comment) => this.isUsefulComment(comment))
      .slice(0, this.maxSavedComments)
      .map(
        (comment): CollectorComment => ({
          externalId: this.buildCommentExternalId(postId, comment),
          content: this.cleanHtml(comment.body),
          author: comment.user?.username ?? comment.user?.name,
          likesCount: 0,
          publishedAt: comment.createdAt
            ? new Date(comment.createdAt)
            : undefined,
        }),
      );
  }

  /**
   * Sends a GraphQL request to the Product Hunt API.
   *
   * The JSON body is first treated as unknown and then
   * validated using the provided runtime validator.
   *
   * @template T Expected GraphQL response type.
   * @param query GraphQL query text.
   * @param variables GraphQL query variables.
   * @param token Product Hunt API access token.
   * @param validator Runtime response validator.
   * @returns Validated GraphQL response.
   */
  private async graphqlRequest<T>(
    query: string,
    variables: Record<string, unknown>,
    token: string,
    validator: GraphqlResponseValidator<T>,
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

    const rawResponse: unknown = await response.json();

    if (!this.isRecord(rawResponse)) {
      throw new Error('Product Hunt API returned an invalid response.');
    }

    const errors = rawResponse.errors;

    if (Array.isArray(errors) && errors.length > 0) {
      this.logger.warn(
        `Product Hunt GraphQL errors: ${this.stringifySafely(errors)}`,
      );

      throw new Error('Product Hunt GraphQL returned one or more errors.');
    }

    if (!validator(rawResponse)) {
      throw new Error(
        'Product Hunt API response does not match the expected structure.',
      );
    }

    return rawResponse;
  }

  /**
   * Builds search terms from user keywords,
   * domain keywords, and the domain name.
   *
   * @param input Collection job configuration.
   * @returns Unique normalized search terms.
   */
  private buildSearchTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([...userKeywords, ...domainKeywords, ...fallbackDomain])
      .filter((term) => term.length >= 2)
      .slice(0, 10);
  }

  /**
   * Validates a Product Hunt post before ranking.
   *
   * @param post Product Hunt post.
   * @returns True when the post contains useful content.
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
   * Calculates post relevance using the shared
   * relevance scoring utility.
   *
   * @param post Product Hunt post.
   * @param input Collection job configuration.
   * @returns Relevance score.
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
   * Maps a Product Hunt post to the unified
   * collector post format.
   *
   * @param post Product Hunt post.
   * @param input Collection job configuration.
   * @param token Product Hunt API access token.
   * @returns Unified collector post.
   */
  private async mapProductToCollectorPost(
    post: ProductHuntPost,
    input: CollectorInput,
    token: string,
  ): Promise<CollectorPost> {
    const postId = post.id ?? '';

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
   * Builds a stable external identifier for a comment.
   *
   * The original comment ID is preferred. When it is missing,
   * the post ID and normalized creation date are used.
   *
   * @param postId Product Hunt post identifier.
   * @param comment Product Hunt comment.
   * @returns Stable external comment identifier.
   */
  private buildCommentExternalId(
    postId: string,
    comment: ProductHuntComment,
  ): string {
    if (comment.id) {
      return comment.id;
    }

    const datePart = comment.createdAt
      ? new Date(comment.createdAt).toISOString()
      : 'unknown-date';

    return `${postId}-${datePart}`;
  }

  /**
   * Filters short, empty, or blocked comments.
   *
   * @param comment Product Hunt comment.
   * @returns True when the comment is useful.
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
   * Reads the Product Hunt API token.
   *
   * @returns Configured API token or an empty string.
   */
  private getToken(): string {
    return this.configService.get<string>('PRODUCT_HUNT_TOKEN') ?? '';
  }

  /**
   * Reads common blocked words and
   * Product Hunt-specific blocked words.
   *
   * @returns Normalized blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('PRODUCT_HUNT_BLOCKED_WORDS');
  }

  /**
   * Builds Product Hunt API request headers.
   *
   * @param token Product Hunt API access token.
   * @returns HTTP request headers.
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
   *
   * @param text Optional HTML text.
   * @returns Clean plain text.
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
   * Validates the Product Hunt posts GraphQL response.
   *
   * @param value Unknown API response.
   * @returns True when the response has a valid posts structure.
   */
  private isProductHuntPostsResponse(
    value: unknown,
  ): value is ProductHuntPostsResponse {
    if (!this.isRecord(value)) {
      return false;
    }

    const data = value.data;

    if (data === undefined) {
      return true;
    }

    if (!this.isRecord(data)) {
      return false;
    }

    const posts = data.posts;

    if (posts === undefined) {
      return true;
    }

    if (!this.isRecord(posts)) {
      return false;
    }

    const edges = posts.edges;

    if (edges !== undefined && !Array.isArray(edges)) {
      return false;
    }

    if (
      Array.isArray(edges) &&
      !edges.every((edge) => this.isGraphqlEdge(edge))
    ) {
      return false;
    }

    const pageInfo = posts.pageInfo;

    if (pageInfo !== undefined && !this.isProductHuntPageInfo(pageInfo)) {
      return false;
    }

    return true;
  }

  /**
   * Validates the Product Hunt comments GraphQL response.
   *
   * @param value Unknown API response.
   * @returns True when the response has a valid comments structure.
   */
  private isProductHuntCommentsResponse(
    value: unknown,
  ): value is ProductHuntCommentsResponse {
    if (!this.isRecord(value)) {
      return false;
    }

    const data = value.data;

    if (data === undefined) {
      return true;
    }

    if (!this.isRecord(data)) {
      return false;
    }

    const post = data.post;

    if (post === undefined || post === null) {
      return true;
    }

    if (!this.isRecord(post)) {
      return false;
    }

    const comments = post.comments;

    if (comments === undefined || comments === null) {
      return true;
    }

    if (!this.isRecord(comments)) {
      return false;
    }

    const edges = comments.edges;

    if (edges === undefined) {
      return true;
    }

    return (
      Array.isArray(edges) && edges.every((edge) => this.isGraphqlEdge(edge))
    );
  }

  /**
   * Validates Product Hunt pagination information.
   *
   * @param value Unknown page information.
   * @returns True when the value has a valid pagination shape.
   */
  private isProductHuntPageInfo(value: unknown): value is ProductHuntPageInfo {
    if (!this.isRecord(value)) {
      return false;
    }

    const hasNextPage = value.hasNextPage;
    const endCursor = value.endCursor;

    return (
      (hasNextPage === undefined || typeof hasNextPage === 'boolean') &&
      (endCursor === undefined || typeof endCursor === 'string')
    );
  }

  /**
   * Validates one generic GraphQL connection edge.
   *
   * @param value Unknown edge value.
   * @returns True when the edge contains a node property.
   */
  private isGraphqlEdge(value: unknown): value is ProductHuntEdge<unknown> {
    return this.isRecord(value) && 'node' in value;
  }

  /**
   * Determines whether an unknown value is a non-null record.
   *
   * @param value Unknown value.
   * @returns True when the value is an object record.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  /**
   * Extracts a readable message from an unknown error.
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

    return 'Unknown Product Hunt collector error.';
  }

  /**
   * Converts an unknown value to a safe log string.
   *
   * @param value Unknown value.
   * @returns Safely serialized value.
   */
  private stringifySafely(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value) ?? 'Unknown GraphQL error';
    } catch {
      return 'Unknown GraphQL error';
    }
  }

  /**
   * Adds a delay between API requests.
   *
   * @param ms Delay in milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
