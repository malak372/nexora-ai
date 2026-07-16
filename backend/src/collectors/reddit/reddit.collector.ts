import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCollector } from '../base/base.collector';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { SocialCollector } from '../base/collector.interface';

import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Represents a Reddit listing wrapper.
 *
 * Reddit listing endpoints return:
 * {
 *   kind: "Listing",
 *   data: {
 *     children: [...]
 *   }
 * }
 */
type RedditListing<T> = {
  kind?: string;

  data?: {
    after?: string | null;
    before?: string | null;
    children?: Array<RedditThing<T>>;
  };
};

/**
 * Represents one Reddit thing.
 *
 * Reddit identifies resources using prefixed IDs:
 * - t1_: comment
 * - t2_: user
 * - t3_: post
 * - t5_: subreddit
 */
type RedditThing<T> = {
  kind?: string;
  data?: T;
};

/**
 * Represents a Reddit post returned by
 * a listing or search endpoint.
 */
type RedditPostData = {
  id?: string;
  name?: string;

  title?: string;
  selftext?: string;

  author?: string;
  subreddit?: string;
  subreddit_name_prefixed?: string;

  permalink?: string;
  url?: string;

  score?: number;
  ups?: number;
  num_comments?: number;

  created_utc?: number;

  over_18?: boolean;
  stickied?: boolean;
  locked?: boolean;
  archived?: boolean;

  is_self?: boolean;
  removed_by_category?: string | null;
};

/**
 * Represents a Reddit comment returned by
 * a comments endpoint.
 */
type RedditCommentData = {
  id?: string;
  name?: string;

  body?: string;
  author?: string;

  parent_id?: string;
  link_id?: string;

  score?: number;
  ups?: number;

  created_utc?: number;

  stickied?: boolean;
  collapsed?: boolean;

  removed?: boolean;
  deleted?: boolean;

  replies?: RedditListing<RedditCommentData> | '';
};

/**
 * Represents a Reddit access-token response.
 */
type RedditTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

/**
 * Stores a Reddit OAuth token in memory until shortly
 * before its expiration.
 */
type CachedRedditToken = {
  accessToken: string;
  expiresAt: number;
};

/**
 * Represents normalized Reddit collector configuration.
 */
type RedditCredentials = {
  clientId: string;
  clientSecret: string;
  userAgent: string;
};

/**
 * Reddit collector.
 *
 * Collects public Reddit posts and top-level comments through
 * Reddit's OAuth Data API.
 *
 * Data-source identity is provided through sourceKey.
 * The sourceKey must match DataSource.key in the database.
 *
 * Important:
 * - This is a NestJS external collector, not a Devvit app.
 * - It does not access private user data.
 * - It does not submit posts, comments, votes, or messages.
 * - It collects only public posts and public comments.
 * - It requires approved Reddit API credentials.
 *
 * Environment variables:
 * - REDDIT_CLIENT_ID
 * - REDDIT_CLIENT_SECRET
 * - REDDIT_USER_AGENT
 *
 * Optional:
 * - REDDIT_DEFAULT_SUBREDDITS
 *
 * Example:
 * REDDIT_DEFAULT_SUBREDDITS=programming,technology,startups
 *
 * @author Malak
 */
@Injectable()
export class RedditCollector extends BaseCollector implements SocialCollector {
  /**
   * Stable collector registry key.
   *
   * Must match:
   * DataSource.key = "reddit"
   */
  readonly sourceKey = 'reddit';

  /**
   * Reddit OAuth token endpoint.
   */
  private readonly tokenUrl = 'https://www.reddit.com/api/v1/access_token';

  /**
   * Authenticated Reddit API base URL.
   */
  private readonly oauthApiBaseUrl = 'https://oauth.reddit.com';

  /**
   * Maximum number of search queries executed
   * for one collection request.
   */
  private readonly maxSearchQueries: number;

  /**
   * Maximum number of subreddits searched directly.
   */
  private readonly maxSubreddits: number;

  /**
   * Delay between Reddit requests to reduce
   * unnecessary rate-limit pressure.
   */
  private readonly requestDelayMs: number;

  /**
   * In-memory OAuth token cache.
   *
   * This prevents requesting a new token for every API call.
   */
  private cachedToken?: CachedRedditToken;

  constructor(configService: ConfigService) {
    super(configService, RedditCollector.name);

    this.maxSearchQueries = this.getPositiveNumber(
      'REDDIT_MAX_SEARCH_QUERIES',
      5,
    );

    this.maxSubreddits = this.getPositiveNumber('REDDIT_MAX_SUBREDDITS', 5);

    this.requestDelayMs = this.getPositiveNumber(
      'REDDIT_REQUEST_DELAY_MS',
      500,
    );
  }

  /**
   * Collects public Reddit posts and their useful comments.
   *
   * Workflow:
   * 1. Validate Reddit credentials.
   * 2. Obtain or reuse an OAuth token.
   * 3. Build search queries.
   * 4. Search Reddit globally or in configured subreddits.
   * 5. Deduplicate and rank posts.
   * 6. Collect useful top-level comments.
   * 7. Return normalized CollectorPost objects.
   *
   * @param input Collection job configuration.
   * @returns Relevant public Reddit posts and comments.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const credentials = this.getCredentials();

    if (!credentials) {
      this.logger.warn(
        'Reddit collection skipped because Reddit API credentials are missing.',
      );

      return [];
    }

    const searchQueries = this.buildSearchQueries(input);

    if (!searchQueries.length) {
      this.logger.warn(
        'Reddit collection skipped because no search keywords exist.',
      );

      return [];
    }

    try {
      const accessToken = await this.getAccessToken(credentials);

      const subreddits = this.getConfiguredSubreddits();

      const collectedPosts: RedditPostData[] = [];

      for (const query of searchQueries) {
        if (collectedPosts.length >= this.maxFetchedPosts) {
          break;
        }

        const posts =
          subreddits.length > 0
            ? await this.searchConfiguredSubreddits(
                query,
                subreddits,
                accessToken,
                credentials.userAgent,
              )
            : await this.searchReddit(
                query,
                undefined,
                accessToken,
                credentials.userAgent,
              );

        collectedPosts.push(...posts);

        await this.delay(this.requestDelayMs);
      }

      const rankedPosts = this.rankAndDeduplicatePosts(collectedPosts, input);

      const result: CollectorPost[] = [];

      for (const item of rankedPosts) {
        if (result.length >= this.maxSavedPosts) {
          break;
        }

        const mappedPost = await this.mapPostToCollectorPost(
          item.post,
          input,
          accessToken,
          credentials.userAgent,
        );

        /*
         * Comments are especially useful for extracting
         * user problems, needs, and repeated complaints.
         *
         * A post is still retained when it has useful
         * textual body content but no comments.
         */
        if (
          mappedPost.comments.length === 0 &&
          mappedPost.content.length < 80
        ) {
          continue;
        }

        result.push(mappedPost);

        await this.delay(this.requestDelayMs);
      }

      this.logger.log(`Reddit collection completed. Posts: ${result.length}`);

      return result;
    } catch (error: unknown) {
      this.logger.error(
        'Reddit collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'Reddit collection failed. Check Reddit API approval, credentials, rate limits, or network connection.',
      );
    }
  }

  /**
   * Searches all configured subreddits.
   *
   * @param query Search query.
   * @param subreddits Configured subreddit names.
   * @param accessToken Reddit OAuth access token.
   * @param userAgent Reddit API User-Agent.
   * @returns Combined public Reddit posts.
   */
  private async searchConfiguredSubreddits(
    query: string,
    subreddits: string[],
    accessToken: string,
    userAgent: string,
  ): Promise<RedditPostData[]> {
    const posts: RedditPostData[] = [];

    for (const subreddit of subreddits.slice(0, this.maxSubreddits)) {
      if (posts.length >= this.maxFetchedPosts) {
        break;
      }

      const subredditPosts = await this.searchReddit(
        query,
        subreddit,
        accessToken,
        userAgent,
      );

      posts.push(...subredditPosts);

      await this.delay(this.requestDelayMs);
    }

    return posts;
  }

  /**
   * Searches Reddit globally or inside one subreddit.
   *
   * @param query Search query.
   * @param subreddit Optional subreddit name.
   * @param accessToken Reddit OAuth access token.
   * @param userAgent Reddit API User-Agent.
   * @returns Public Reddit posts.
   */
  private async searchReddit(
    query: string,
    subreddit: string | undefined,
    accessToken: string,
    userAgent: string,
  ): Promise<RedditPostData[]> {
    const normalizedSubreddit = this.normalizeSubredditName(subreddit);

    const scope = normalizedSubreddit ? `r/${normalizedSubreddit}` : 'all';

    const endpoint = normalizedSubreddit
      ? `${this.oauthApiBaseUrl}/r/${normalizedSubreddit}/search`
      : `${this.oauthApiBaseUrl}/search`;

    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'search', [
      scope,
      query,
    ]);

    const response = await CollectorHttpUtil.getWithRetryAndCache<
      RedditListing<RedditPostData>
    >(
      endpoint,
      {
        headers: this.buildAuthenticatedHeaders(accessToken, userAgent),

        params: {
          q: query,

          restrict_sr: normalizedSubreddit ? 'true' : 'false',

          sort: 'relevance',

          /*
           * Recent content is generally more useful for
           * discovering current software problems.
           */
          t: 'year',

          limit: Math.min(this.maxFetchedPosts, 100),

          raw_json: 1,
        },

        timeout: 10_000,
      },
      {
        cacheKey,

        cacheTtlMs: this.cacheTtlMs,

        retryAttempts: this.retryAttempts,

        retryDelayMs: this.retryDelayMs,
      },
    );

    return (response.data?.children ?? [])
      .map((child) => child.data)
      .filter((post): post is RedditPostData => Boolean(post));
  }

  /**
   * Builds Reddit search queries from user keywords,
   * domain keywords, domain name, and problem terms.
   *
   * @param input Collection job configuration.
   * @returns Normalized search queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const domainName = this.cleanNormalizedText(input.domainName);

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const baseTerms = this.unique([
      ...userKeywords,
      ...domainKeywords,
      domainName,
    ])
      .filter((term) => term.length >= 2)
      .slice(0, 6);

    if (!baseTerms.length) {
      return [];
    }

    const problemTerms = this.getProblemWords()
      .map((term) => this.cleanNormalizedText(term))
      .filter(Boolean)
      .slice(0, 4);

    const queries = [
      ...baseTerms,

      ...baseTerms
        .slice(0, 3)
        .flatMap((term) =>
          problemTerms.map((problemTerm) => `${term} ${problemTerm}`),
        ),
    ];

    return this.unique(queries).slice(0, this.maxSearchQueries);
  }

  /**
   * Deduplicates, validates, and ranks Reddit posts.
   *
   * @param posts Raw Reddit posts.
   * @param input Collection job configuration.
   * @returns Ranked Reddit posts.
   */
  private rankAndDeduplicatePosts(
    posts: RedditPostData[],
    input: CollectorInput,
  ): Array<{
    post: RedditPostData;
    score: number;
  }> {
    const seenPostIds = new Set<string>();

    return posts
      .filter((post) => this.isValidPost(post))
      .filter((post) => {
        const id = this.getPostId(post);

        if (!id || seenPostIds.has(id)) {
          return false;
        }

        seenPostIds.add(id);

        return true;
      })
      .map((post) => ({
        post,

        score: this.calculatePostRelevanceScore(post, input),
      }))
      .filter((item) => item.score > 0)
      .sort((first, second) => second.score - first.score)
      .slice(0, this.maxSavedPosts);
  }

  /**
   * Validates a Reddit post before ranking.
   *
   * Filters:
   * - Missing identifiers.
   * - Deleted or removed content.
   * - Adult-marked content.
   * - Sticky moderator posts.
   * - Very short content.
   * - Blocked terms.
   *
   * @param post Reddit post.
   * @returns True when the post is useful.
   */
  private isValidPost(post: RedditPostData): boolean {
    const id = this.getPostId(post);

    const title = this.cleanPlainText(post.title);

    const body = this.cleanPlainText(post.selftext);

    const author = this.cleanNormalizedText(post.author);

    const content = this.cleanNormalizedText(`${title} ${body}`);

    if (
      !id ||
      !title ||
      post.over_18 === true ||
      post.stickied === true ||
      post.removed_by_category ||
      author === '[deleted]' ||
      body === '[deleted]' ||
      body === '[removed]' ||
      content.length < 30
    ) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates Reddit-post relevance.
   *
   * @param post Reddit post.
   * @param input Collection job configuration.
   * @returns Relevance score.
   */
  private calculatePostRelevanceScore(
    post: RedditPostData,
    input: CollectorInput,
  ): number {
    const baseScore = RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(post.title),

      body: this.cleanPlainText(post.selftext),

      domainTerms: this.getDomainKeywords(input),

      problemTerms: this.getProblemWords(),

      likes: post.score ?? post.ups ?? 0,

      replies: post.num_comments ?? 0,

      publishedAt: this.parseUnixDate(post.created_utc),
    });

    return baseScore + this.calculateUserKeywordBonus(post, input);
  }

  /**
   * Adds relevance for explicit user-keyword matches.
   *
   * @param post Reddit post.
   * @param input Collection job configuration.
   * @returns User-keyword bonus.
   */
  private calculateUserKeywordBonus(
    post: RedditPostData,
    input: CollectorInput,
  ): number {
    const keywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const title = this.cleanNormalizedText(post.title);

    const body = this.cleanNormalizedText(post.selftext);

    let bonus = 0;

    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        bonus += 30;
      }

      if (body.includes(keyword)) {
        bonus += 15;
      }
    }

    return bonus;
  }

  /**
   * Maps one Reddit post to CollectorPost.
   *
   * The source identity is not duplicated inside the post.
   * DataCollectionService resolves sourceKey to DataSource.id.
   *
   * @param post Reddit post.
   * @param input Collection job configuration.
   * @param accessToken Reddit OAuth token.
   * @param userAgent Reddit API User-Agent.
   * @returns Normalized collector post.
   */
  private async mapPostToCollectorPost(
    post: RedditPostData,
    input: CollectorInput,
    accessToken: string,
    userAgent: string,
  ): Promise<CollectorPost> {
    const postId = this.getPostId(post);

    const title = this.cleanPlainText(post.title);

    const body = this.cleanPlainText(post.selftext);

    const comments = await this.collectPostComments(
      post,
      accessToken,
      userAgent,
      input,
    );

    return {
      externalId: postId,

      title,

      content: body || title,

      author: this.cleanPlainText(post.author),

      url: this.resolvePostUrl(post),

      country: undefined,
      city: undefined,
      region: undefined,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: post.score ?? post.ups ?? 0,

      repliesCount: post.num_comments ?? comments.length,

      publishedAt: this.parseUnixDate(post.created_utc),

      comments,
    };
  }

  /**
   * Collects useful public top-level comments
   * for one Reddit post.
   *
   * Reddit's comments endpoint returns an array:
   * - First listing: post information.
   * - Second listing: comments.
   *
   * @param post Reddit post.
   * @param accessToken Reddit OAuth token.
   * @param userAgent Reddit API User-Agent.
   * @param input Collection job input.
   * @returns Useful normalized comments.
   */
  private async collectPostComments(
    post: RedditPostData,
    accessToken: string,
    userAgent: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    const postId = this.getPostId(post);

    const subreddit = this.normalizeSubredditName(post.subreddit);

    if (!postId || !subreddit || (post.num_comments ?? 0) <= 0) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'comments', [
        subreddit,
        postId,
      ]);

      const response = await CollectorHttpUtil.getWithRetryAndCache<
        Array<RedditListing<RedditPostData | RedditCommentData>>
      >(
        `${this.oauthApiBaseUrl}/r/${subreddit}/comments/${postId}`,
        {
          headers: this.buildAuthenticatedHeaders(accessToken, userAgent),

          params: {
            sort: 'top',

            limit: Math.min(this.maxFetchedComments, 100),

            depth: 1,

            raw_json: 1,
          },

          timeout: 10_000,
        },
        {
          cacheKey,

          cacheTtlMs: this.cacheTtlMs,

          retryAttempts: this.retryAttempts,

          retryDelayMs: this.retryDelayMs,
        },
      );

      const commentsListing = response[1] as
        | RedditListing<RedditCommentData>
        | undefined;

      const rawComments = commentsListing?.data?.children ?? [];

      const seenCommentIds = new Set<string>();

      return rawComments
        .filter((thing) => thing.kind === 't1')
        .map((thing) => thing.data)
        .filter((comment): comment is RedditCommentData => Boolean(comment))
        .filter((comment) => this.isUsefulComment(comment, input))
        .filter((comment) => {
          const id = this.getCommentId(comment);

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);

          return true;
        })
        .sort(
          (first, second) =>
            (second.score ?? second.ups ?? 0) - (first.score ?? first.ups ?? 0),
        )
        .slice(0, this.maxSavedComments)
        .map(
          (comment): CollectorComment => ({
            externalId: this.getCommentId(comment),

            content: this.cleanPlainText(comment.body),

            author: this.cleanPlainText(comment.author),

            languageCode: this.resolveStoredLanguageCode(input.language),

            likesCount: comment.score ?? comment.ups ?? 0,

            publishedAt: this.parseUnixDate(comment.created_utc),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Reddit comments collection failed for post ${postId}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Validates one public Reddit comment.
   *
   * @param comment Reddit comment.
   * @param input Collection job configuration.
   * @returns True when the comment is useful.
   */
  private isUsefulComment(
    comment: RedditCommentData,
    input: CollectorInput,
  ): boolean {
    const body = this.cleanPlainText(comment.body);

    const content = this.cleanNormalizedText(body);

    const author = this.cleanNormalizedText(comment.author);

    if (
      !this.getCommentId(comment) ||
      content.length < 40 ||
      body === '[deleted]' ||
      body === '[removed]' ||
      author === '[deleted]' ||
      comment.removed === true ||
      comment.deleted === true
    ) {
      return false;
    }

    if (!CollectorLanguageUtil.matchesRequestedLanguage(body, input.language)) {
      return false;
    }

    if (this.isLowValueComment(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Detects short and generic comments that are
   * unlikely to help NLP analysis.
   *
   * @param content Normalized comment content.
   * @returns True when low-value.
   */
  private isLowValueComment(content: string): boolean {
    const lowValuePatterns = [
      /^thanks$/i,
      /^thank you$/i,
      /^great$/i,
      /^nice$/i,
      /^cool$/i,
      /^awesome$/i,
      /^lol$/i,
      /^same$/i,
      /^me too$/i,
      /^i agree$/i,
      /^\+1$/i,
      /^this$/i,
      /^yes$/i,
      /^no$/i,
      /\bthis works\b/i,
      /\bwell said\b/i,
      /\bexactly this\b/i,
    ];

    return lowValuePatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Obtains a Reddit OAuth access token.
   *
   * The token is cached in memory and reused until
   * shortly before its expiration.
   *
   * @param credentials Reddit API credentials.
   * @returns OAuth access token.
   */
  private async getAccessToken(
    credentials: RedditCredentials,
  ): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.accessToken;
    }

    const basicCredentials = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
    ).toString('base64');

    const formBody = new URLSearchParams({
      grant_type: 'client_credentials',
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',

      headers: {
        Authorization: `Basic ${basicCredentials}`,

        'Content-Type': 'application/x-www-form-urlencoded',

        Accept: 'application/json',

        'User-Agent': credentials.userAgent,
      },

      body: formBody.toString(),
    });

    if (!response.ok) {
      const responseBody = await response.text();

      throw new Error(
        `Reddit OAuth failed with status ${response.status}: ${responseBody}`,
      );
    }

    const rawResponse: unknown = await response.json();

    if (!this.isRedditTokenResponse(rawResponse) || !rawResponse.access_token) {
      throw new Error(
        'Reddit OAuth returned an invalid access-token response.',
      );
    }

    const expiresInSeconds =
      Number.isFinite(rawResponse.expires_in) &&
      (rawResponse.expires_in ?? 0) > 0
        ? rawResponse.expires_in!
        : 3_600;

    this.cachedToken = {
      accessToken: rawResponse.access_token,

      expiresAt: Date.now() + expiresInSeconds * 1_000,
    };

    return rawResponse.access_token;
  }

  /**
   * Reads and validates Reddit API credentials.
   *
   * @returns Credentials or undefined when incomplete.
   */
  private getCredentials(): RedditCredentials | undefined {
    const clientId = this.configService.get<string>('REDDIT_CLIENT_ID')?.trim();

    const clientSecret = this.configService
      .get<string>('REDDIT_CLIENT_SECRET')
      ?.trim();

    const userAgent = this.configService
      .get<string>('REDDIT_USER_AGENT')
      ?.trim();

    if (!clientId || !clientSecret || !userAgent) {
      return undefined;
    }

    return {
      clientId,
      clientSecret,
      userAgent,
    };
  }

  /**
   * Reads optional subreddit names from configuration.
   *
   * Example:
   * REDDIT_DEFAULT_SUBREDDITS=programming,startups,technology
   *
   * @returns Normalized unique subreddit names.
   */
  private getConfiguredSubreddits(): string[] {
    const rawValue =
      this.configService.get<string>('REDDIT_DEFAULT_SUBREDDITS') ?? '';

    return this.unique(
      rawValue
        .split(',')
        .map((subreddit) => this.normalizeSubredditName(subreddit))
        .filter(Boolean),
    );
  }

  /**
   * Normalizes a subreddit name.
   *
   * Accepts:
   * - programming
   * - r/programming
   * - /r/programming
   *
   * @param subreddit Raw subreddit name.
   * @returns Safe subreddit name.
   */
  private normalizeSubredditName(subreddit?: string): string {
    return (subreddit ?? '')
      .trim()
      .replace(/^\/?r\//i, '')
      .replace(/[^a-z0-9_]/gi, '')
      .toLowerCase();
  }

  /**
   * Returns a stable Reddit post identifier.
   *
   * Reddit may return:
   * - id: abc123
   * - name: t3_abc123
   *
   * The internal post ID without the t3_ prefix
   * is used as the external ID.
   *
   * @param post Reddit post.
   * @returns Stable post identifier.
   */
  private getPostId(post: RedditPostData): string {
    if (post.id) {
      return post.id;
    }

    if (post.name?.startsWith('t3_')) {
      return post.name.slice(3);
    }

    return post.name ?? '';
  }

  /**
   * Returns a stable Reddit comment identifier.
   *
   * @param comment Reddit comment.
   * @returns Stable comment identifier.
   */
  private getCommentId(comment: RedditCommentData): string {
    if (comment.id) {
      return comment.id;
    }

    if (comment.name?.startsWith('t1_')) {
      return comment.name.slice(3);
    }

    return comment.name ?? '';
  }

  /**
   * Resolves the public Reddit post URL.
   *
   * @param post Reddit post.
   * @returns Public Reddit URL.
   */
  private resolvePostUrl(post: RedditPostData): string | undefined {
    if (post.permalink) {
      return `https://www.reddit.com${post.permalink}`;
    }

    return post.url;
  }

  /**
   * Builds authenticated Reddit API headers.
   *
   * @param accessToken OAuth token.
   * @param userAgent Reddit User-Agent.
   * @returns Request headers.
   */
  private buildAuthenticatedHeaders(
    accessToken: string,
    userAgent: string,
  ): Record<string, string> {
    return {
      ...CollectorHeaderUtil.bearer(accessToken),

      'User-Agent': userAgent,
    };
  }

  /**
   * Reads common and Reddit-specific blocked words.
   *
   * @returns Merged blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('REDDIT_BLOCKED_WORDS');
  }

  /**
   * Parses a Reddit Unix timestamp safely.
   *
   * @param value Unix timestamp in seconds.
   * @returns Parsed date.
   */
  private parseUnixDate(value?: number): Date | undefined {
    if (!value || !Number.isFinite(value)) {
      return undefined;
    }

    const date = new Date(value * 1_000);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Validates an unknown Reddit OAuth response.
   *
   * @param value Unknown response.
   * @returns True when the structure is valid.
   */
  private isRedditTokenResponse(value: unknown): value is RedditTokenResponse {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      (value.access_token === undefined ||
        typeof value.access_token === 'string') &&
      (value.token_type === undefined ||
        typeof value.token_type === 'string') &&
      (value.expires_in === undefined ||
        typeof value.expires_in === 'number') &&
      (value.scope === undefined || typeof value.scope === 'string')
    );
  }

  /**
   * Determines whether a value is a non-null object.
   *
   * @param value Unknown value.
   * @returns True when value is a record.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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

  /**
   * Extracts a safe error message.
   *
   * @param error Unknown caught error.
   * @returns Readable error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown Reddit collector error.';
  }
}
