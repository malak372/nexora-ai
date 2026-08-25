import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import Parser from 'rss-parser';

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
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';
import { RequestEvidenceAlignmentUtil } from '../../ideas/generation/utils/request-evidence-alignment.util';
import { RequestDynamicQueryUtil } from '../../ideas/generation/utils/request-dynamic-query.util';
import { RequestWorkflowIntentProfileUtil } from '../../ideas/generation/utils/request-workflow-intent-profile.util';
import { RequestNicheCustomCraftUtil } from '../../ideas/generation/utils/request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from '../../ideas/generation/utils/request-online-pharmacy-fraud.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';

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

type RedditRssItem = {
  guid?: string;
  link?: string;
  title?: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  author?: string;
  isoDate?: string;
  pubDate?: string;
};

/**
 * Reddit collector.
 *
 * Collects public Reddit posts and comments. OAuth is preferred when valid
 * application credentials exist; otherwise the collector uses Reddit's public
 * read-only RSS feeds. Public JSON is intentionally not required because it may
 * reject unauthenticated requests.
 *
 * Data-source identity is provided through sourceKey.
 * The sourceKey must match DataSource.key in the database.
 *
 * Important:
 * - This is a NestJS external collector, not a Devvit app.
 * - It does not access private user data.
 * - It does not submit posts, comments, votes, or messages.
 * - It collects only public posts and public comments.
 * - No credentials are required for the read-only RSS mode.
 *
 * Optional OAuth acceleration:
 * - REDDIT_CLIENT_ID
 * - REDDIT_CLIENT_SECRET
 * - REDDIT_USER_AGENT
 * - REDDIT_PUBLIC_READ_ENABLED=false to disable anonymous RSS fallback
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

  /** Legacy anonymous endpoint retained only by dormant helper methods.
   * Automatic generation never uses it without valid OAuth credentials.
   */
  private readonly publicApiBaseUrl = 'https://www.reddit.com';

  private readonly rssParser = new Parser();

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

  private readonly maxFastCommentThreads: number;

  private readonly fastCollectionBudgetMs: number;

  private readonly targetedCollectionBudgetMs: number;

  private readonly publicRateLimitCooldownMs: number;

  private publicRssCircuitOpenUntil = 0;

  /**
   * In-memory OAuth token cache.
   *
   * This prevents requesting a new token for every API call.
   */
  private cachedToken?: CachedRedditToken;

  constructor(
    configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
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

    this.maxFastCommentThreads = this.getPositiveNumber(
      'REDDIT_MAX_FAST_COMMENT_THREADS',
      2,
    );

    this.fastCollectionBudgetMs = this.getPositiveNumber(
      'REDDIT_FAST_COLLECTION_BUDGET_MS',
      6_600,
    );

    this.targetedCollectionBudgetMs = this.getPositiveNumber(
      'REDDIT_TARGETED_COLLECTION_BUDGET_MS',
      5_800,
    );

    this.publicRateLimitCooldownMs = this.getPositiveNumber(
      'REDDIT_PUBLIC_RATE_LIMIT_COOLDOWN_MS',
      60_000,
    );
  }

  /**
   * Collects public Reddit posts and their useful comments.
   *
   * Workflow:
   * 1. Build request-specific search queries.
   * 2. Require valid OAuth credentials and reuse the cached access token.
   * 3. Search globally for bounded generation and recovery.
   * 4. Deduplicate and rank posts.
   * 5. Collect useful comments when the JSON API exposes a thread.
   * 6. Return normalized CollectorPost objects.
   *
   * @param input Collection job configuration.
   * @returns Relevant public Reddit posts and comments.
   */
  isRuntimeAvailable(): boolean {
    if (this.getCredentials() !== undefined) return true;
    if (!this.isPublicReadEnabled()) return false;
    return !this.isPublicRssCircuitOpen();
  }

  getRuntimeUnavailableReason(): string | null {
    if (this.getCredentials() !== undefined) return null;
    if (!this.isPublicReadEnabled()) {
      return 'Reddit OAuth is unavailable and public read-only RSS collection is disabled.';
    }
    if (this.isPublicRssCircuitOpen()) {
      return 'Reddit public RSS is temporarily rate-limited; the collector circuit is cooling down.';
    }
    return null;
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const searchQueries = this.buildSearchQueries(input);
    const collectionDeadlineMs = this.resolveCollectionDeadlineMs(
      input.collectionMode,
    );

    if (!searchQueries.length) {
      this.logger.warn(
        'Reddit collection skipped because no search keywords exist.',
      );
      return [];
    }

    const credentials = this.getCredentials();
    const userAgent = credentials?.userAgent ?? this.getPublicUserAgent();
    let accessToken: string | undefined;
    if (credentials) {
      try {
        accessToken = await this.getAccessToken(credentials);
      } catch (error: unknown) {
        this.logger.debug(
          `Reddit OAuth unavailable; falling back to public read-only RSS. error=${this.getErrorMessage(error)}`,
        );
      }
    }
    if (!accessToken && !this.isPublicReadEnabled()) {
      this.logger.debug('Reddit collection skipped because OAuth failed and public RSS is disabled.');
      return [];
    }
    if (!accessToken && this.isPublicRssCircuitOpen()) {
      this.logger.debug(
        'Reddit public RSS collection skipped because the rate-limit circuit is cooling down.',
      );
      return [];
    }

    try {
      const configuredSubreddits = this.getConfiguredSubreddits();
      const requestSubreddits = this.resolveRequestSubreddits(input);
      const queryWindow = searchQueries.slice(
        0,
        input.collectionMode === 'STANDARD'
          ? this.maxSearchQueries
          : Math.min(3, this.maxSearchQueries),
      );
      const useConfiguredSubreddits =
        input.collectionMode === 'STANDARD' &&
        configuredSubreddits.length > 0;

      /*
       * AI routing hints are authoritative for bounded request-scoped Reddit
       * collection. Searching r/vintagecameras/r/camerarepair first prevents a
       * valid niche query from falling through to an unrelated global RSS feed.
       * Global Reddit remains a bounded fallback when the hinted communities do
       * not return enough material.
       */
      let collectedPosts: RedditPostData[] = [];
      if (accessToken) {
        if (requestSubreddits.length > 0 && input.collectionMode !== 'STANDARD') {
          for (const [index, subreddit] of requestSubreddits.slice(0, 2).entries()) {
            const query = queryWindow[index % Math.max(1, queryWindow.length)];
            if (!query) break;
            collectedPosts.push(
              ...(await this.searchReddit(
                query,
                subreddit,
                accessToken,
                userAgent,
              )),
            );
            if (collectedPosts.length >= this.maxSavedPosts) break;
          }
        } else {
          collectedPosts = (
            await Promise.all(
              queryWindow.map((query) =>
                useConfiguredSubreddits
                  ? this.searchConfiguredSubreddits(
                      query,
                      configuredSubreddits,
                      accessToken,
                      userAgent,
                    )
                  : this.searchReddit(query, undefined, accessToken, userAgent),
              ),
            )
          ).flat();
        }
      } else {
        if (requestSubreddits.length > 0) {
          for (const [index, subreddit] of requestSubreddits.slice(0, 2).entries()) {
            if (
              this.isPublicRssCircuitOpen() ||
              !this.hasCollectionBudget(collectionDeadlineMs, 3_100)
            ) {
              break;
            }
            const query = queryWindow[index % Math.max(1, queryWindow.length)];
            if (!query) break;
            collectedPosts.push(
              ...(await this.searchRedditRss(query, subreddit, userAgent)),
            );
            if (collectedPosts.length >= this.maxSavedPosts) break;
            if (
              index < Math.min(2, requestSubreddits.length) - 1 &&
              !this.isPublicRssCircuitOpen() &&
              this.hasCollectionBudget(
                collectionDeadlineMs,
                this.requestDelayMs + 3_100,
              )
            ) {
              await this.delay(this.requestDelayMs);
            }
          }
        }

        /*
         * When PREPARING gave us concrete subreddit/community routing, do not
         * fall through to Reddit-wide RSS merely because a niche community was
         * sparse or rate-limited. Global fallback was the source of unrelated
         * BORU/politics/game posts entering restoration requests. Other first-
         * pass collectors provide breadth more safely than abandoning identity.
         */
        const globalQueryLimit = requestSubreddits.length > 0 ? 0 : queryWindow.length;
        if (
          collectedPosts.length < 2 &&
          !this.isPublicRssCircuitOpen()
        ) {
          for (const [index, query] of queryWindow
            .slice(0, globalQueryLimit)
            .entries()) {
            if (
              this.isPublicRssCircuitOpen() ||
              !this.hasCollectionBudget(collectionDeadlineMs, 3_100)
            ) {
              break;
            }
            collectedPosts.push(
              ...(await this.searchRedditRss(query, '', userAgent)),
            );
            if (
              index < globalQueryLimit - 1 &&
              !this.isPublicRssCircuitOpen() &&
              this.hasCollectionBudget(
                collectionDeadlineMs,
                this.requestDelayMs + 3_100,
              )
            ) {
              await this.delay(this.requestDelayMs);
            }
          }
        }
      }

      if (
        !collectedPosts.some(
          (post) => this.isValidPost(post) && this.isRequestCandidatePost(post, input),
        ) &&
        input.requestDescription?.trim() &&
        input.collectionMode !== 'STANDARD' &&
        this.hasCollectionBudget(collectionDeadlineMs, 3_100)
      ) {
        const attempted = new Set(queryWindow.map((query) => this.cleanNormalizedText(query)));
        const fallbackQueries = ProblemFirstCollectorQueryUtil.buildProgressiveFallback({
          sourceKey: this.sourceKey,
          domainName: input.domainName,
          requestDescription: input.requestDescription,
          plannedQueries: input.plannedQueries,
          keywords: input.keywords,
          authoritativePlannedQueries: input.authoritativePlannedQueries,
        })
          .filter((query) => !attempted.has(this.cleanNormalizedText(query)))
          .slice(0, 3);

        if (fallbackQueries.length > 0) {
          if (accessToken) {
            collectedPosts = requestSubreddits.length > 0
              ? (
                  await Promise.all(
                    fallbackQueries.slice(0, 2).map((query, index) =>
                      this.searchReddit(
                        query,
                        requestSubreddits[index % requestSubreddits.length],
                        accessToken,
                        userAgent,
                        'all',
                      ),
                    ),
                  )
                ).flat()
              : (
                  await Promise.all(
                    fallbackQueries.map((query) =>
                      this.searchReddit(
                        query,
                        undefined,
                        accessToken,
                        userAgent,
                        'all',
                      ),
                    ),
                  )
                ).flat();
          } else {
            const fallbackPosts: RedditPostData[] = [];
            const scopedFallbackQueries = requestSubreddits.length > 0
              ? fallbackQueries.slice(0, Math.min(2, requestSubreddits.length))
              : fallbackQueries;
            for (const [index, query] of scopedFallbackQueries.entries()) {
              if (
                this.isPublicRssCircuitOpen() ||
                !this.hasCollectionBudget(collectionDeadlineMs, 3_100)
              ) {
                break;
              }
              fallbackPosts.push(
                ...(await this.searchRedditRss(
                  query,
                  requestSubreddits.length > 0
                    ? requestSubreddits[index % requestSubreddits.length]
                    : '',
                  userAgent,
                  'all',
                )),
              );
              if (
                index < scopedFallbackQueries.length - 1 &&
                !this.isPublicRssCircuitOpen() &&
                this.hasCollectionBudget(
                  collectionDeadlineMs,
                  this.requestDelayMs + 3_100,
                )
              ) {
                await this.delay(this.requestDelayMs);
              }
            }
            collectedPosts = fallbackPosts;
          }
        }
      }

      const rankedPosts = this.rankAndDeduplicatePosts(collectedPosts, input);
      const mapped: CollectorPost[] = [];
      const rankedWindow = rankedPosts.slice(0, this.maxSavedPosts);
      for (const [index, item] of rankedWindow.entries()) {
        const collectComments = Boolean(
          accessToken ||
            input.collectionMode === 'STANDARD' ||
            (index < this.maxFastCommentThreads &&
              !this.isPublicRssCircuitOpen() &&
              this.hasCollectionBudget(collectionDeadlineMs, 3_800)),
        );
        mapped.push(
          await this.mapPostToCollectorPost(
            item.post,
            input,
            accessToken,
            userAgent,
            collectComments,
          ),
        );
        if (
          !accessToken &&
          collectComments &&
          index < rankedWindow.length - 1 &&
          !this.isPublicRssCircuitOpen() &&
          this.hasCollectionBudget(
            collectionDeadlineMs,
            this.requestDelayMs + 3_800,
          )
        ) {
          await this.delay(this.requestDelayMs);
        }
      }
      const result = mapped.filter(
        (post) => post.comments.length > 0 || post.content.length >= 80,
      );

      this.logger.log(
        `Reddit collection completed. mode=${accessToken ? 'oauth' : 'public-rss'} Posts: ${result.length}`,
      );

      return result;
    } catch (error: unknown) {
      this.logger.warn(
        `Reddit collection failed non-fatally. error=${this.getErrorMessage(error)}`,
      );
      return [];
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
    accessToken: string | undefined,
    userAgent: string,
  ): Promise<RedditPostData[]> {
    const posts: RedditPostData[] = [];

    for (const subreddit of subreddits.slice(0, this.maxSubreddits)) {
      if (posts.length >= this.maxFetchedPosts) {
        break;
      }

      const subredditPosts = accessToken
        ? await this.searchReddit(
            query,
            subreddit,
            accessToken,
            userAgent,
          )
        : await this.searchRedditRss(
            query,
            this.normalizeSubredditName(subreddit),
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
    accessToken: string | undefined,
    userAgent: string,
    timeRange: 'year' | 'all' = 'year',
  ): Promise<RedditPostData[]> {
    const normalizedSubreddit = this.normalizeSubredditName(subreddit);

    if (!accessToken) {
      return this.searchRedditRss(query, normalizedSubreddit, userAgent, timeRange);
    }

    const scope = normalizedSubreddit ? `r/${normalizedSubreddit}` : 'all';

    const endpoint = accessToken
      ? normalizedSubreddit
        ? `${this.oauthApiBaseUrl}/r/${normalizedSubreddit}/search`
        : `${this.oauthApiBaseUrl}/search`
      : normalizedSubreddit
        ? `${this.publicApiBaseUrl}/r/${normalizedSubreddit}/search.json`
        : `${this.publicApiBaseUrl}/search.json`;

    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'search', [
      scope,
      query,
    ]);

    try {
      const response = await CollectorHttpUtil.getWithRetryAndCache<
        RedditListing<RedditPostData>
      >(
        endpoint,
        {
          headers: this.buildRequestHeaders(accessToken, userAgent),
          params: {
            q: query,
            restrict_sr: normalizedSubreddit ? 'true' : 'false',
            sort: 'relevance',
            t: timeRange,
            limit: Math.min(this.maxFetchedPosts, 100),
            raw_json: 1,
          },
          timeout: accessToken ? 7_000 : 2_800,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: accessToken ? this.retryAttempts : 0,
          retryDelayMs: this.retryDelayMs,
        },
      );

      return (response.data?.children ?? [])
        .map((child) => child.data)
        .filter((post): post is RedditPostData => Boolean(post));
    } catch (error: unknown) {
      if (accessToken) throw error;
      this.logger.debug(
        `Reddit public JSON search failed; trying RSS fallback. query=${query} error=${this.getErrorMessage(error)}`,
      );
      return this.searchRedditRss(
        query,
        normalizedSubreddit,
        userAgent,
        timeRange,
      );
    }
  }

  private async searchRedditRss(
    query: string,
    subreddit: string,
    userAgent: string,
    timeRange: 'year' | 'all' = 'year',
  ): Promise<RedditPostData[]> {
    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'rss-search', [
      subreddit || 'all',
      query,
      timeRange,
    ]);
    const cached = CollectorCacheUtil.get<RedditPostData[]>(cacheKey);
    if (cached) return cached;
    if (this.isPublicRssCircuitOpen()) return [];

    const endpoint = subreddit
      ? `${this.publicApiBaseUrl}/r/${subreddit}/search.rss`
      : `${this.publicApiBaseUrl}/search.rss`;
    const url = `${endpoint}?${new URLSearchParams({
      q: query,
      sort: 'relevance',
      t: timeRange,
      ...(subreddit ? { restrict_sr: '1' } : {}),
    }).toString()}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<string>(url, {
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': userAgent,
          },
          timeout: 2_800,
          responseType: 'text',
        }),
      );
      const feed = await this.rssParser.parseString(response.data);
      const posts = (feed.items ?? [])
        .map((item): RedditPostData | null => {
          const rssItem = item as RedditRssItem;
          const link = rssItem.link?.trim() ?? '';
          const idMatch = link.match(/\/comments\/([a-z0-9]+)\//iu);
          const subredditMatch = link.match(/\/r\/([^/]+)\/comments\//iu);
          const id = idMatch?.[1] ?? this.cleanPlainText(rssItem.guid);
          const title = this.cleanPlainText(rssItem.title);
          const selftext = this.cleanPlainText(
            rssItem.contentSnippet ?? rssItem.content,
          );
          if (!id || !title) return null;
          return {
            id,
            title,
            selftext,
            author: this.cleanPlainText(rssItem.creator ?? rssItem.author),
            subreddit: (subredditMatch?.[1] ?? subreddit) || undefined,
            permalink: link.startsWith(this.publicApiBaseUrl)
              ? link.slice(this.publicApiBaseUrl.length)
              : undefined,
            url: link || undefined,
            created_utc: this.parseRssDate(rssItem.isoDate ?? rssItem.pubDate),
            score: 0,
            ups: 0,
            num_comments: 0,
          };
        })
        .filter((post): post is RedditPostData => Boolean(post))
        .filter((post) => {
          if (!subreddit) return true;
          return this.normalizeSubredditName(post.subreddit) ===
            this.normalizeSubredditName(subreddit);
        })
        .slice(0, this.maxFetchedPosts);
      CollectorCacheUtil.set(cacheKey, posts, this.cacheTtlMs);
      return posts;
    } catch (error: unknown) {
      if (subreddit && this.isRateLimitError(error)) {
        const localFeedPosts = await this.readSubredditFeedRss(
          subreddit,
          userAgent,
        );
        if (localFeedPosts.length > 0) {
          this.logger.debug(
            `Reddit scoped search was rate-limited; retained ${localFeedPosts.length} locally filtered post candidate(s) from r/${subreddit} RSS instead.`,
          );
          return localFeedPosts;
        }
      }
      this.openPublicRssCircuitOnRateLimit(error);
      this.logger.debug(
        `Reddit RSS fallback failed non-fatally. query=${query} error=${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async readSubredditFeedRss(
    subreddit: string,
    userAgent: string,
  ): Promise<RedditPostData[]> {
    const normalizedSubreddit = this.normalizeSubredditName(subreddit);
    if (!normalizedSubreddit) return [];

    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'rss-subreddit-feed', [
      normalizedSubreddit,
    ]);
    const cached = CollectorCacheUtil.get<RedditPostData[]>(cacheKey);
    if (cached) return cached;

    const url = `${this.publicApiBaseUrl}/r/${normalizedSubreddit}/new.rss`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<string>(url, {
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': userAgent,
          },
          timeout: 2_600,
          responseType: 'text',
        }),
      );
      const feed = await this.rssParser.parseString(response.data);
      const posts = (feed.items ?? [])
        .map((item): RedditPostData | null => {
          const rssItem = item as RedditRssItem;
          const link = rssItem.link?.trim() ?? '';
          const idMatch = link.match(/\/comments\/([a-z0-9]+)\//iu);
          const id = idMatch?.[1] ?? this.cleanPlainText(rssItem.guid);
          const title = this.cleanPlainText(rssItem.title);
          const selftext = this.cleanPlainText(
            rssItem.contentSnippet ?? rssItem.content,
          );
          if (!id || !title) return null;
          return {
            id,
            title,
            selftext,
            author: this.cleanPlainText(rssItem.creator ?? rssItem.author),
            subreddit: normalizedSubreddit,
            permalink: link.startsWith(this.publicApiBaseUrl)
              ? link.slice(this.publicApiBaseUrl.length)
              : undefined,
            url: link || undefined,
            created_utc: this.parseRssDate(rssItem.isoDate ?? rssItem.pubDate),
            score: 0,
            ups: 0,
            num_comments: 0,
          };
        })
        .filter((post): post is RedditPostData => Boolean(post))
        .slice(0, this.maxFetchedPosts);
      CollectorCacheUtil.set(cacheKey, posts, this.cacheTtlMs);
      return posts;
    } catch (error: unknown) {
      this.logger.debug(
        `Reddit subreddit-feed fallback failed non-fatally. subreddit=${normalizedSubreddit} error=${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private parseRssDate(value?: string): number | undefined {
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : undefined;
  }

  /**
   * Builds Reddit search queries from user keywords,
   * domain keywords, domain name, and problem terms.
   *
   * @param input Collection job configuration.
   * @returns Normalized search queries.
   */
  private resolveCollectionDeadlineMs(
    mode: CollectorInput['collectionMode'],
  ): number | null {
    if (mode === 'STANDARD') return null;

    const budgetMs =
      mode === 'TARGETED_RECOVERY'
        ? this.targetedCollectionBudgetMs
        : this.fastCollectionBudgetMs;

    return Date.now() + Math.max(1_500, budgetMs);
  }

  private hasCollectionBudget(
    deadlineMs: number | null,
    requiredMs: number,
  ): boolean {
    if (deadlineMs === null) return true;
    return deadlineMs - Date.now() >= Math.max(0, requiredMs);
  }

  private buildSearchQueries(input: CollectorInput): string[] {
    if (input.requestDescription?.trim()) {
      const sourceAwareQueries = ProblemFirstCollectorQueryUtil.build({
        sourceKey: this.sourceKey,
        domainName: input.domainName,
        requestDescription: input.requestDescription,
        plannedQueries: input.plannedQueries,
        keywords: input.keywords,
        authoritativePlannedQueries: input.authoritativePlannedQueries,
      });
      return this.unique(sourceAwareQueries)
        .map((query) =>
          input.authoritativePlannedQueries
            ? query.trim()
            : this.relaxSearchQuery(query),
        )
        .filter(Boolean)
        .slice(0, this.maxSearchQueries);
    }

    const plannedQueries = (input.plannedQueries ?? [])
      .map((query) => this.cleanNormalizedText(query))
      .filter(Boolean);

    if (plannedQueries.length > 0) {
      const domainAnchor = this.cleanNormalizedText(input.domainName);
      const relaxed = plannedQueries
        .map((query) => this.relaxSearchQuery(query))
        .filter(Boolean);

      return this.unique([
        ...relaxed.slice(0, 3),
        ...plannedQueries.slice(0, 3),
        ...(domainAnchor ? [this.relaxSearchQuery(domainAnchor)] : []),
      ]).slice(0, this.maxSearchQueries);
    }

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

  private relaxSearchQuery(value: string): string {
    const stopWords = new Set([
      'problem', 'problems', 'issue', 'issues', 'complaint', 'complaints',
      'difficult', 'difficulty', 'business', 'businesses', 'system', 'systems',
      'reports', 'analysis', 'analyze', 'organization', 'organizing', 'app',
      'application', 'tracker', 'tool', 'for', 'and', 'the', 'of', 'to',
    ]);

    return this.cleanNormalizedText(value)
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => !stopWords.has(token))
      .slice(0, 7)
      .join(' ');
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
      .filter((item) => this.isRequestCandidatePost(item.post, input))
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
   * Rejects global-RSS noise before it enters the canonical raw evidence
   * corpus. Community AI still owns semantic classification, but the collector
   * must preserve at least the requester object/actor plus one workflow or pain
   * axis so an unrelated popular Reddit post cannot become an AI candidate.
   */
  private isRequestCandidatePost(
    post: RedditPostData,
    input: CollectorInput,
  ): boolean {
    const request = this.cleanNormalizedText(input.requestDescription);
    if (!request) return true;

    const evidence = this.cleanNormalizedText(
      `${this.cleanPlainText(post.title)} ${this.cleanPlainText(post.selftext)}`,
    );
    if (!evidence) return false;

    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      return RequestOnlinePharmacyFraudUtil.isPlausibleRetrievalCandidate(
        request,
        evidence,
      );
    }
    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isPlausibleRetrievalCandidate(
        request,
        evidence,
      );
    }

    const verticalConstraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: request,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries,
    });
    if ([
      'PUBLIC_PROGRAM_COST_ATTRIBUTION',
      'OPERATIONAL_COST_ATTRIBUTION',
      'HEALTHCARE_SUPPLY_COST_EFFICIENCY',
      'AGRICULTURE_DISTRIBUTION_PROFITABILITY',
      'AGRICULTURE_EXPORT_PROFITABILITY',
    ].includes(verticalConstraint.kind)) {
      /*
       * High-signal business/operations verticals should not let a globally
       * popular Reddit result into the raw ledger merely because it shares a
       * generic domain word such as finance, budget, inventory, or delivery.
       * Direct and Supporting classifications are both retained; unrelated
       * posts are rejected at the source boundary before Community AI cost.
       */
      return RequestEvidenceAlignmentUtil.classifyForRequest({
        requestDescription: request,
        evidenceText: evidence,
        plannedQueries: input.plannedQueries ?? [],
      }) !== 'UNRELATED';
    }

    if (
      RequestEvidenceAlignmentUtil.isAligned({
        requestDescription: request,
        evidenceText: evidence,
        plannedQueries: input.plannedQueries ?? [],
      })
    ) {
      return true;
    }

    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    const genericIdentityTerms = new Set([
      'business', 'businesses', 'company', 'companies', 'customer', 'customers',
      'client', 'clients', 'specialist', 'specialists', 'service', 'services',
      'project', 'projects', 'management', 'workflow', 'workflows', 'history',
      'information', 'records', 'record', 'notes', 'problem', 'problems',
    ]);
    const identityTerms = this.unique([
      ...profile.objectIdentityTerms,
      ...RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request),
      RequestDynamicQueryUtil.extractActor(request),
    ])
      .map((value) => this.cleanNormalizedText(value))
      .filter((value) => value.length >= 4)
      .filter((value) => !genericIdentityTerms.has(value));

    const identityMatched = identityTerms.some((term) =>
      evidence.includes(term),
    );
    const workflowTerms = RequestDynamicQueryUtil.extractWorkflowTerms(request)
      .map((value) => this.cleanNormalizedText(value))
      .filter((value) => value.length >= 4);
    const painTerms = RequestDynamicQueryUtil.extractPainTerms(request)
      .map((value) => this.cleanNormalizedText(value))
      .filter((value) => value.length >= 4);
    const workflowMatched = workflowTerms.some((term) =>
      evidence.includes(term),
    );
    const painMatched = painTerms.some((term) => evidence.includes(term));

    const stopWords = new Set([
      'often', 'struggle', 'understand', 'which', 'some', 'despite', 'similar',
      'frequently', 'analyzed', 'separately', 'making', 'difficult', 'identify',
      'information', 'usually', 'scattered', 'across', 'maintain', 'complete',
      'lead', 'leading', 'project', 'projects', 'customer', 'customers', 'company',
      'companies', 'specialist', 'specialists', 'independent', 'service', 'services',
    ]);
    const requestTokens = request
      .split(/\s+/u)
      .filter((token) => token.length >= 5 && !stopWords.has(token));
    const evidenceTokens = new Set(evidence.split(/\s+/u));
    const tokenOverlap = [...new Set(requestTokens)].filter((token) =>
      evidenceTokens.has(token),
    ).length;

    return (identityMatched && (workflowMatched || painMatched || tokenOverlap >= 2)) ||
      (tokenOverlap >= 3 && (workflowMatched || painMatched));
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
    accessToken: string | undefined,
    userAgent: string,
    collectComments = true,
  ): Promise<CollectorPost> {
    const postId = this.getPostId(post);

    const title = this.cleanPlainText(post.title);

    const body = this.cleanPlainText(post.selftext);

    const comments = collectComments
      ? await this.collectPostComments(
          post,
          accessToken,
          userAgent,
          input,
        )
      : [];

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
    accessToken: string | undefined,
    userAgent: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    const postId = this.getPostId(post);

    const subreddit = this.normalizeSubredditName(post.subreddit);

    if (!postId || !subreddit) {
      return [];
    }
    if (!accessToken) {
      return this.collectPostCommentsRss(postId, subreddit, userAgent, input);
    }
    if ((post.num_comments ?? 0) <= 0) {
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
        accessToken
          ? `${this.oauthApiBaseUrl}/r/${subreddit}/comments/${postId}`
          : `${this.publicApiBaseUrl}/r/${subreddit}/comments/${postId}.json`,
        {
          headers: this.buildRequestHeaders(accessToken, userAgent),

          params: {
            sort: 'top',

            limit: Math.min(this.maxFetchedComments, 100),

            depth: 1,

            raw_json: 1,
          },

          timeout: accessToken ? 7_000 : 4_500,
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

  private async collectPostCommentsRss(
    postId: string,
    subreddit: string,
    userAgent: string,
    input: CollectorInput,
  ): Promise<CollectorComment[]> {
    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'rss-comments', [
      subreddit,
      postId,
    ]);
    const cached = CollectorCacheUtil.get<CollectorComment[]>(cacheKey);
    if (cached) return cached;
    if (this.isPublicRssCircuitOpen()) return [];

    const url = `${this.publicApiBaseUrl}/r/${subreddit}/comments/${postId}/.rss`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<string>(url, {
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': userAgent,
          },
          timeout: 3_500,
          responseType: 'text',
        }),
      );
      const feed = await this.rssParser.parseString(response.data);
      const seen = new Set<string>();
      const comments: CollectorComment[] = [];
      for (const item of feed.items ?? []) {
        const rssItem = item as RedditRssItem;
        const content = this.cleanPlainText(
          rssItem.contentSnippet ?? rssItem.content,
        );
        if (content.length < 40) continue;
        if (!CollectorLanguageUtil.matchesRequestedLanguage(content, input.language)) continue;
        const link = rssItem.link?.trim() ?? '';
        const id =
          link.match(/\/comments\/[a-z0-9]+\/[^/]+\/([a-z0-9]+)\/?/iu)?.[1] ??
          this.cleanPlainText(rssItem.guid) ??
          '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        comments.push({
          externalId: id.slice(0, 120),
          content,
          author: this.cleanPlainText(rssItem.creator ?? rssItem.author),
          languageCode: this.resolveStoredLanguageCode(input.language),
          publishedAt: this.parseRssDate(rssItem.isoDate ?? rssItem.pubDate)
            ? new Date((this.parseRssDate(rssItem.isoDate ?? rssItem.pubDate) ?? 0) * 1_000)
            : undefined,
        });
        if (comments.length >= this.maxSavedComments) break;
      }
      CollectorCacheUtil.set(cacheKey, comments, this.cacheTtlMs);
      return comments;
    } catch (error: unknown) {
      this.openPublicRssCircuitOnRateLimit(error);
      this.logger.debug(
        `Reddit comments RSS failed non-fatally. post=${postId} error=${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private isPublicRssCircuitOpen(): boolean {
    return this.publicRssCircuitOpenUntil > Date.now();
  }

  private isRateLimitError(error: unknown): boolean {
    const errorRecord =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : null;
    const responseRecord =
      errorRecord?.response && typeof errorRecord.response === 'object'
        ? (errorRecord.response as Record<string, unknown>)
        : null;
    const statusValue =
      error instanceof AxiosError
        ? error.response?.status
        : responseRecord?.status ?? errorRecord?.statusCode ?? errorRecord?.status;
    const status = typeof statusValue === 'number'
      ? statusValue
      : Number(statusValue);
    return status === 429 || /(?:\b429\b|too many requests)/iu.test(
      this.getErrorMessage(error),
    );
  }

  private openPublicRssCircuitOnRateLimit(error: unknown): void {
    const errorRecord =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : null;
    const responseRecord =
      errorRecord?.response && typeof errorRecord.response === 'object'
        ? (errorRecord.response as Record<string, unknown>)
        : null;
    if (!this.isRateLimitError(error)) {
      return;
    }

    const headersRecord: Record<string, unknown> | null =
      error instanceof AxiosError && error.response?.headers
        ? (error.response.headers as unknown as Record<string, unknown>)
        : responseRecord?.headers && typeof responseRecord.headers === 'object'
          ? (responseRecord.headers as Record<string, unknown>)
          : null;
    const retryAfterHeader = headersRecord?.['retry-after'];
    const retryAfterValue = Array.isArray(retryAfterHeader)
      ? retryAfterHeader[0]
      : retryAfterHeader;
    const retryAfterSeconds = Number(retryAfterValue);
    const parsedHttpDate =
      typeof retryAfterValue === 'string' && !Number.isFinite(retryAfterSeconds)
        ? Date.parse(retryAfterValue)
        : Number.NaN;
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1_000
      : Number.isFinite(parsedHttpDate)
        ? Math.max(0, parsedHttpDate - Date.now())
        : 0;
    const cooldownMs = Math.max(
      this.publicRateLimitCooldownMs,
      Math.min(retryAfterMs, 5 * 60_000),
    );
    const nextOpenUntil = Date.now() + cooldownMs;
    const wasOpen = this.isPublicRssCircuitOpen();
    this.publicRssCircuitOpenUntil = Math.max(
      this.publicRssCircuitOpenUntil,
      nextOpenUntil,
    );

    if (!wasOpen) {
      this.logger.warn(
        `Reddit public RSS rate-limit circuit opened for ${Math.ceil(cooldownMs / 1_000)}s; later searches, comment fetches, and recovery waves will skip Reddit instead of repeating 429 requests.`,
      );
    }
  }

  private isPublicReadEnabled(): boolean {
    const configured = this.configService.get<string>('REDDIT_PUBLIC_READ_ENABLED');
    if (configured == null || configured.trim() === '') return true;
    return !['0', 'false', 'no', 'off'].includes(configured.trim().toLocaleLowerCase());
  }

  private getPublicUserAgent(): string {
    const configured = this.configService.get<string>('REDDIT_USER_AGENT')?.trim();
    return configured && !/your[_ -]?reddit[_ -]?username|your[_ -]?user/iu.test(configured)
      ? configured
      : 'web:voxidence-public-evidence:v1.0.0';
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
    /*
     * Reddit access tokens are reused until one minute before expiration.
     * This avoids requesting a new token for every collection request.
     */
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.accessToken;
    }

    const basicCredentials = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
    ).toString('base64');

    const formBody = new URLSearchParams({
      grant_type: 'client_credentials',
    });

    try {
      /*
       * HttpService is NestJS's Axios integration.
       * firstValueFrom converts the returned Observable into a Promise.
       */
      const response = await firstValueFrom(
        this.httpService.post<RedditTokenResponse>(
          this.tokenUrl,
          formBody.toString(),
          {
            headers: {
              Authorization: `Basic ${basicCredentials}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              'User-Agent': credentials.userAgent,
            },
            timeout: 10_000,
          },
        ),
      );

      const tokenResponse = response.data;

      if (
        !this.isRedditTokenResponse(tokenResponse) ||
        !tokenResponse.access_token
      ) {
        throw new Error(
          'Reddit OAuth returned an invalid access-token response.',
        );
      }

      const expiresInSeconds =
        Number.isFinite(tokenResponse.expires_in) &&
        (tokenResponse.expires_in ?? 0) > 0
          ? tokenResponse.expires_in!
          : 3_600;

      this.cachedToken = {
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + expiresInSeconds * 1_000,
      };

      return tokenResponse.access_token;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        const responseData: unknown = error.response?.data;

        throw new Error(
          `Reddit OAuth failed${
            status ? ` with status ${status}` : ''
          }: ${this.stringifyErrorPayload(responseData ?? error.message)}`,
        );
      }

      throw error;
    }
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

    if (
      !this.isRealCredential(clientId, ['your-client-id', 'client-id']) ||
      !this.isRealCredential(clientSecret, [
        'your-client-secret',
        'client-secret',
      ])
    ) {
      return undefined;
    }

    const safeUserAgent =
      userAgent && !/your[_ -]?reddit[_ -]?username|your[_ -]?user/iu.test(userAgent)
        ? userAgent
        : 'web:voxidence:v1.0.0';

    return {
      clientId,
      clientSecret,
      userAgent: safeUserAgent,
    };
  }

  private isRealCredential(
    value: string | undefined,
    placeholders: readonly string[],
  ): value is string {
    if (!value) return false;
    const normalized = value.trim().toLocaleLowerCase();
    if (!normalized) return false;
    return !placeholders.some((placeholder) =>
      normalized.includes(placeholder.toLocaleLowerCase()),
    );
  }

  /**
   * Resolves request-scoped subreddit targets from AI routing hints first, then
   * from a very small deterministic professional fallback for common domains.
   * These targets are used only to narrow public search; they never count as
   * evidence by themselves.
   */
  private resolveRequestSubreddits(input: CollectorInput): string[] {
    const hinted = (input.sourceHints ?? []).flatMap((hint) => {
      const normalized = hint.trim();
      const redditUrlMatch = normalized.match(/reddit\.com\/r\/([a-z0-9_]+)/iu);
      const directMatch = normalized.match(/(?:^|\s)\/?r\/([a-z0-9_]+)/iu);
      const value = redditUrlMatch?.[1] ?? directMatch?.[1];
      return value ? [this.normalizeSubredditName(value)] : [];
    });

    const request = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
    ].join(' '));
    const inferred: string[] = [
      ...RequestNicheCustomCraftUtil.preferredSubreddits(input.requestDescription),
      ...(RequestOnlinePharmacyFraudUtil.isRequest(input.requestDescription)
        ? RequestOnlinePharmacyFraudUtil.preferredSubreddits()
        : []),
    ];
    const workflowProfile = RequestWorkflowIntentProfileUtil.resolve(
      input.requestDescription,
    );
    if (inferred.length > 0) {
      // Request-scoped niche communities were resolved from the workflow profile.
    } else if (workflowProfile.restorationIntent && workflowProfile.restorationSubject) {
      const subject = this.cleanNormalizedText(workflowProfile.restorationSubject);
      if (/\b(?:stained glass|leaded glass|architectural glass)\b/u.test(subject)) {
        inferred.push('stainedglass', 'woodworking');
      } else if (/\b(?:book|manuscript|paper|binding)\b/u.test(subject)) {
        inferred.push('bookbinding', 'bookrepair');
      } else if (/\b(?:jewelry|jewellery|ring|brooch|bracelet|necklace)\b/u.test(subject)) {
        inferred.push('jewelrymaking', 'benchjewelers');
      } else if (/\b(?:textile|fabric|tapestry|rug|carpet)\b/u.test(subject)) {
        inferred.push('textiles', 'visiblemending');
      } else if (/\b(?:wood|door|frame|furniture|gilded|gilding)\b/u.test(subject)) {
        inferred.push('woodworking', 'finishing');
      } else {
        inferred.push('restoration', 'crafts');
      }
    } else if (/\b(?:eyeglass frame repair|eyeglass repair|eyewear repair|optical frame repair|spectacle frame repair|glasses repair)\b/u.test(request)) {
      inferred.push('optometry', 'glasses');
    } else if (/\b(?:vintage camera|antique camera|film camera|camera restoration|camera repair)\b/u.test(request)) {
      inferred.push('vintagecameras', 'camerarepair', 'analogcommunity');
    } else if (/\b(?:fountain pen|fountain pens|nib repair|nib restoration|pen restoration|pen repair)\b/u.test(request)) {
      inferred.push('fountainpens', 'pen_swap');
    } else if (/\b(?:antique textile|historic textile|textile restoration|textile conservation|fabric conservation)\b/u.test(request)) {
      inferred.push('textiles', 'antiques');
    } else if (
      /\b(?:agricultural distributors?|produce distributors?|fresh produce distributors?|crop distributors?|agricultural wholesalers?|produce wholesalers?)\b/u.test(request) &&
      /\b(?:storage|warehouse|transport|delivery|spoilage|market price|profitability|margin|route)\w*\b/u.test(request)
    ) {
      inferred.push('farming', 'agriculture', 'supplychain');
    } else if (/\b(?:logistics|freight|3pl|warehouse|delivery routes?|supply chain)\b/u.test(request)) {
      inferred.push('logistics', 'supplychain');
    } else if (/\b(?:bookplate|printmaking|ex libris)\b/u.test(request)) {
      inferred.push('printmaking', 'bookbinding');
    }

    return this.unique([...hinted, ...inferred])
      .map((value) => this.normalizeSubredditName(value))
      .filter(Boolean)
      .slice(0, Math.min(3, this.maxSubreddits));
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
  private buildRequestHeaders(
    accessToken: string | undefined,
    userAgent: string,
  ): Record<string, string> {
    return {
      ...(accessToken ? CollectorHeaderUtil.bearer(accessToken) : {}),
      Accept: 'application/json',
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
   * Converts an unknown HTTP error payload into a readable string.
   *
   * @param payload Unknown Axios response body.
   * @returns Safe readable representation.
   */
  private stringifyErrorPayload(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload;
    }

    try {
      return JSON.stringify(payload);
    } catch {
      return 'Unknown HTTP response payload.';
    }
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
