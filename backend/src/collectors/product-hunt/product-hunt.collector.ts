import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
 * Data-source identity is provided through sourceKey.
 * The sourceKey must match DataSource.key in the database.
 *
 * Notes:
 * - Requires PRODUCT_HUNT_TOKEN.
 * - Uses cursor-based pagination.
 * - Filters posts locally using domain and user keywords.
 * - Adds small delays between external requests.
 * - Validates unknown GraphQL responses at runtime.
 *
 * @author Malak
 */
@Injectable()
export class ProductHuntCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Stable collector registry key.
   *
   * Must match:
   * DataSource.key = "product-hunt"
   */
  readonly sourceKey = 'product-hunt';

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
   * and maps them to CollectorPost.
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
        .filter((item) => item.score > 0)
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
      const response: ProductHuntPostsResponse =
        await this.graphqlRequest<ProductHuntPostsResponse>(
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

      const edges = postsConnection?.edges ?? [];

      const pageInfo = postsConnection?.pageInfo;

      const posts = edges.map((edge) => edge.node);

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
    const normalizedTerms = searchTerms.map((term) =>
      this.cleanNormalizedText(term),
    );

    const domainKeywords = this.getDomainKeywords(input).map((keyword) =>
      this.cleanNormalizedText(keyword),
    );

    const allTerms = this.unique([...normalizedTerms, ...domainKeywords]);

    return posts.filter((post) => {
      const content = this.cleanNormalizedText(
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
    if (!postId) {
      return [];
    }

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

    try {
      const response = await this.graphqlRequest<ProductHuntCommentsResponse>(
        query,
        {
          id: postId,
          first: this.commentsPageSize,
        },
        token,
        (value: unknown): value is ProductHuntCommentsResponse =>
          this.isProductHuntCommentsResponse(value),
      );

      const edges = response.data?.post?.comments?.edges ?? [];

      return edges
        .map((edge) => edge.node)
        .filter((comment) => this.isUsefulComment(comment))
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: this.buildCommentExternalId(postId, comment),

            content: this.cleanPlainText(comment.body),

            author: this.cleanPlainText(
              comment.user?.username ?? comment.user?.name,
            ),

            likesCount: 0,

            publishedAt: this.parseDate(comment.createdAt),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Product Hunt comments collection failed for post ${postId}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Sends a validated GraphQL request.
   *
   * @template T Expected GraphQL response type.
   * @param query GraphQL query text.
   * @param variables GraphQL variables.
   * @param token Product Hunt API token.
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
      throw new Error(
        `Product Hunt API failed with status ${response.status}.`,
      );
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
   * domain keywords, and domain name.
   *
   * @param input Collection job configuration.
   * @returns Unique normalized search terms.
   */
  private buildSearchTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    return this.unique([...userKeywords, ...domainKeywords, ...fallbackDomain])
      .filter((term) => term.length >= 2)
      .slice(0, 10);
  }

  /**
   * Validates a Product Hunt post.
   *
   * @param post Product Hunt post.
   * @returns True when useful.
   */
  private isValidPost(post: ProductHuntPost): boolean {
    const title = this.cleanPlainText(post.name);

    const body = this.cleanPlainText(
      `${post.tagline ?? ''} ${post.description ?? ''}`,
    );

    const content = this.cleanNormalizedText(`${title} ${body}`);

    if (!post.id || !title || content.length < 20) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates post relevance.
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
      title: this.cleanPlainText(post.name),

      body: this.cleanPlainText(
        `${post.tagline ?? ''} ${post.description ?? ''}`,
      ),

      domainTerms: this.getDomainKeywords(input),

      problemTerms: this.getProblemWords(),

      likes: post.votesCount ?? 0,

      replies: post.commentsCount ?? 0,

      publishedAt: this.parseDate(post.createdAt),
    });
  }

  /**
   * Maps a Product Hunt post to CollectorPost.
   *
   * The source identity is not stored inside the post object.
   * DataCollectionService already resolves sourceKey to DataSource.id.
   *
   * @param post Product Hunt post.
   * @param input Collection job configuration.
   * @param token Product Hunt API token.
   * @returns Unified collector post.
   */
  private async mapProductToCollectorPost(
    post: ProductHuntPost,
    input: CollectorInput,
    token: string,
  ): Promise<CollectorPost> {
    const postId = post.id ?? '';

    const comments = await this.collectProductComments(postId, token);

    const title = this.cleanPlainText(post.name);

    const content = this.cleanPlainText(
      [post.tagline, post.description].filter(Boolean).join('\n\n'),
    );

    return {
      externalId: postId,

      title,

      content: content || title,

      author: this.cleanPlainText(post.user?.username ?? post.user?.name),

      url: post.url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: post.votesCount ?? 0,

      repliesCount: post.commentsCount ?? comments.length,

      publishedAt: this.parseDate(post.createdAt),

      comments,
    };
  }

  /**
   * Builds a stable external comment identifier.
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

    const datePart =
      this.parseDate(comment.createdAt)?.toISOString() ?? 'unknown-date';

    const contentPart = this.cleanNormalizedText(comment.body).slice(0, 50);

    return `${postId}-${datePart}-${contentPart}`;
  }

  /**
   * Filters short, empty, or blocked comments.
   *
   * @param comment Product Hunt comment.
   * @returns True when useful.
   */
  private isUsefulComment(comment: ProductHuntComment): boolean {
    const content = this.cleanNormalizedText(comment.body);

    if (content.length < 10) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Reads the Product Hunt API token.
   */
  private getToken(): string {
    return this.configService.get<string>('PRODUCT_HUNT_TOKEN') ?? '';
  }

  /**
   * Reads Product Hunt-specific blocked words.
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
   * Parses an external date safely.
   */
  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Validates the Product Hunt posts response.
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
   * Validates the Product Hunt comments response.
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
   * Validates pagination information.
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
   * Validates one GraphQL connection edge.
   */
  private isGraphqlEdge(value: unknown): value is ProductHuntEdge<unknown> {
    return this.isRecord(value) && 'node' in value;
  }

  /**
   * Determines whether a value is a non-null record.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  /**
   * Extracts a safe error message.
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
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
