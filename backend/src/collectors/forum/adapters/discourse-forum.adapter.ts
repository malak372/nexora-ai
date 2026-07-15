import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCollector } from '../../base/base.collector';
import { CollectorCacheUtil } from '../../base/collector-cache.util';
import { CollectorHeaderUtil } from '../../base/collector-header.util';
import { CollectorHttpUtil } from '../../base/collector-http.util';

import {
  CollectorComment,
  CollectorInput,
  CollectorPost,
} from '../../base/collector.types';

import { ForumAdapter } from './forum-adapter.interface';

type DiscourseTopic = {
  id?: number;
  slug?: string;
  title?: string;
  created_at?: string;
  like_count?: number;
  last_poster_username?: string;
};

type DiscourseSearchPost = {
  topic_id?: number;
  blurb?: string;
  excerpt?: string;
  username?: string;
};

type DiscourseReply = {
  id?: number;
  cooked?: string;
  excerpt?: string;
  username?: string;
  like_count?: number;
  created_at?: string;
};

type DiscourseSearchResponse = {
  topics?: DiscourseTopic[];
  posts?: DiscourseSearchPost[];
};

type DiscourseTopicResponse = {
  post_stream?: {
    posts?: DiscourseReply[];
  };
};

/**
 * Adapter for Discourse-based forums.
 *
 * The adapter does not expose a sourceKey because the parent
 * ForumCollector owns DataSource.key = "forum".
 *
 * @author Malak
 */
@Injectable()
export class DiscourseForumAdapter
  extends BaseCollector
  implements ForumAdapter
{
  readonly engineName = 'Discourse';

  constructor(configService: ConfigService) {
    super(
      configService,
      DiscourseForumAdapter.name,
    );
  }

  /**
   * Collects public Discourse topics.
   */
  async collect(
    forumUrl: string,
    searchQuery: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const cacheKey = CollectorCacheUtil.build(
        'forum',
        'discourse-search',
        [
          forumUrl,
          searchQuery,
          input.country,
          input.language,
        ],
      );

      const data =
        await CollectorHttpUtil.getWithRetryAndCache<DiscourseSearchResponse>(
          `${forumUrl}/search.json`,
          {
            headers: this.buildHeaders(),
            params: {
              q: searchQuery,
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

      const topics = data.topics ?? [];
      const searchPosts = data.posts ?? [];

      const validTopics = topics
        .filter((topic) => this.isValidTopic(topic))
        .slice(0, Math.min(this.maxFetchedPosts, 5));

      const posts: CollectorPost[] = [];

      for (const topic of validTopics) {
        posts.push(
          await this.mapTopicToCollectorPost(
            topic,
            searchPosts,
            forumUrl,
            input,
          ),
        );
      }

      return posts;
    } catch (error: unknown) {
      this.logger.warn(
        `Discourse forum skipped: ${forumUrl} - ${this.getErrorMessage(
          error,
        )}`,
      );

      return [];
    }
  }

  /**
   * Maps one Discourse topic.
   */
  private async mapTopicToCollectorPost(
    topic: DiscourseTopic,
    searchPosts: DiscourseSearchPost[],
    forumUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const matchedPost = searchPosts.find(
      (post) => post.topic_id === topic.id,
    );

    const topicId = topic.id ?? 0;

    const comments = await this.collectTopicReplies(
      forumUrl,
      topicId,
    );

    const title = this.cleanPlainText(topic.title);

    return {
      externalId: `${this.normalizeForumUrl(forumUrl)}-${topicId}`,

      title,

      content:
        this.cleanPlainText(
          matchedPost?.blurb ??
            matchedPost?.excerpt,
        ) || title,

      author:
        topic.last_poster_username ??
        matchedPost?.username,

      url: `${forumUrl}/t/${topic.slug}/${topicId}`,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(
        input.language,
      ),

      likesCount: topic.like_count ?? 0,
      repliesCount: comments.length,

      publishedAt: this.parseDate(topic.created_at),

      comments,
    };
  }

  /**
   * Collects useful Discourse replies.
   */
  private async collectTopicReplies(
    forumUrl: string,
    topicId: number,
  ): Promise<CollectorComment[]> {
    if (!topicId) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build(
        'forum',
        'discourse-replies',
        [
          forumUrl,
          topicId,
        ],
      );

      const data =
        await CollectorHttpUtil.getWithRetryAndCache<DiscourseTopicResponse>(
          `${forumUrl}/t/${topicId}.json`,
          {
            headers: this.buildHeaders(),
            timeout: 10_000,
          },
          {
            cacheKey,
            cacheTtlMs: this.cacheTtlMs,
            retryAttempts: this.retryAttempts,
            retryDelayMs: this.retryDelayMs,
          },
        );

      const topicPosts = data.post_stream?.posts ?? [];
      const seenCommentIds = new Set<string>();

      return topicPosts
        .filter((post) => this.isUsefulReply(post))
        .filter((post) => {
          const id = post.id?.toString();

          if (!id || seenCommentIds.has(id)) {
            return false;
          }

          seenCommentIds.add(id);

          return true;
        })
        .slice(0, this.maxSavedComments)
        .map(
          (post): CollectorComment => ({
            externalId: `${this.normalizeForumUrl(
              forumUrl,
            )}-${post.id?.toString() ?? ''}`,

            content: this.cleanPlainText(
              post.cooked ?? post.excerpt,
            ),

            author: this.cleanPlainText(post.username),
            likesCount: post.like_count ?? 0,
            publishedAt: this.parseDate(post.created_at),
          }),
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to collect Discourse replies for topic ${topicId}`,
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Validates one Discourse topic.
   */
  private isValidTopic(topic: DiscourseTopic): boolean {
    const title = this.cleanNormalizedText(topic.title);

    if (!topic.id || !topic.slug || !title) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      title.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Filters low-value replies.
   */
  private isUsefulReply(post: DiscourseReply): boolean {
    const content = this.cleanNormalizedText(
      post.cooked ?? post.excerpt,
    );

    if (!post.id || content.length < 30) {
      return false;
    }

    const cleaned = content
      .replace(/[^\p{L}\p{N}\s+]/gu, '')
      .trim();

    if (!cleaned) {
      return false;
    }

    const author = this.cleanNormalizedText(post.username);

    if (author === 'system') {
      return false;
    }

    const lowValueReplies = new Set([
      'thanks',
      'thank you',
      'great',
      'good',
      'awesome',
      'nice',
      'same',
      'me too',
      '+1',
      'fixed',
      'works',
      'solved',
    ]);

    if (lowValueReplies.has(content)) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      content.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Reads forum-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('FORUM_BLOCKED_WORDS');
  }

  /**
   * Builds public Discourse request headers.
   */
  private buildHeaders(): Record<string, string> {
    return {
      ...CollectorHeaderUtil.json(),
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }

  /**
   * Normalizes a forum URL for external identifiers.
   */
  private normalizeForumUrl(forumUrl: string): string {
    return forumUrl
      .replace(/^https?:\/\//i, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
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
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string'
      ? error
      : 'Unknown Discourse forum error.';
  }
}