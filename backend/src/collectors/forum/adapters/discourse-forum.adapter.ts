import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

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

/**
 * Represents a Discourse topic returned by
 * the public Discourse search API.
 */
type DiscourseTopic = {
  id?: number;
  slug?: string;
  title?: string;
  created_at?: string;
  like_count?: number;
  last_poster_username?: string;
};

/**
 * Represents a matching post returned alongside
 * a Discourse search topic.
 */
type DiscourseSearchPost = {
  topic_id?: number;
  blurb?: string;
  excerpt?: string;
  username?: string;
};

/**
 * Represents a reply returned by a Discourse topic endpoint.
 */
type DiscourseReply = {
  id?: number;
  cooked?: string;
  excerpt?: string;
  username?: string;
  like_count?: number;
  created_at?: string;
};

/**
 * Represents the response returned by the
 * Discourse search endpoint.
 */
type DiscourseSearchResponse = {
  topics?: DiscourseTopic[];
  posts?: DiscourseSearchPost[];
};

/**
 * Represents the response returned by the
 * Discourse topic endpoint.
 */
type DiscourseTopicResponse = {
  post_stream?: {
    posts?: DiscourseReply[];
  };
};

/**
 * Adapter for Discourse-based forums.
 *
 * Uses public Discourse JSON endpoints:
 * - /search.json
 * - /t/{topicId}.json
 *
 * @author Malak
 */
@Injectable()
export class DiscourseForumAdapter
  extends BaseCollector
  implements ForumAdapter
{
  /**
   * Platform source type stored with collected records.
   */
  readonly sourceType = CollectionSourceType.FORUM;

  /**
   * Forum engine handled by this adapter.
   */
  readonly engineName = 'Discourse';

  /**
   * Human-readable platform name.
   */
  private readonly platformName = 'Forum';

  constructor(configService: ConfigService) {
    super(configService, DiscourseForumAdapter.name);
  }

  /**
   * Collects public Discourse topics and maps them
   * to the unified collector post format.
   *
   * @param forumUrl Base URL of the Discourse forum.
   * @param searchQuery Search query used by Discourse.
   * @param input Collection job configuration.
   * @returns Collected forum topics and replies.
   */
  async collect(
    forumUrl: string,
    searchQuery: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    try {
      const cacheKey = CollectorCacheUtil.build('forum', 'discourse-search', [
        forumUrl,
        searchQuery,
        input.country,
        input.language,
      ]);

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
        const post = await this.mapTopicToCollectorPost(
          topic,
          searchPosts,
          forumUrl,
          input,
        );

        posts.push(post);
      }

      return posts;
    } catch (error: unknown) {
      this.logger.warn(
        `Discourse forum skipped: ${forumUrl} - ${this.getErrorMessage(error)}`,
      );

      return [];
    }
  }

  /**
   * Maps a Discourse topic to the unified
   * collector post format.
   *
   * @param topic Discourse topic.
   * @param searchPosts Search result posts.
   * @param forumUrl Base forum URL.
   * @param input Collection job configuration.
   * @returns Unified collector post.
   */
  private async mapTopicToCollectorPost(
    topic: DiscourseTopic,
    searchPosts: DiscourseSearchPost[],
    forumUrl: string,
    input: CollectorInput,
  ): Promise<CollectorPost> {
    const matchedPost = searchPosts.find((post) => post.topic_id === topic.id);

    const topicId = topic.id ?? 0;

    const comments = await this.collectTopicReplies(forumUrl, topicId);

    return {
      sourceType: CollectionSourceType.FORUM,
      platformName: `${this.platformName} - ${this.engineName}`,
      externalId: String(topicId),
      title: topic.title,
      content: this.stripHtml(
        matchedPost?.blurb ?? matchedPost?.excerpt ?? topic.title ?? '',
      ),
      author: topic.last_poster_username ?? matchedPost?.username,
      url: `${forumUrl}/t/${topic.slug}/${topicId}`,
      country: input.country,
      city: input.city,
      region: input.region,
      language: input.language,
      likesCount: topic.like_count ?? 0,
      repliesCount: comments.length,
      publishedAt: topic.created_at ? new Date(topic.created_at) : undefined,
      comments,
    };
  }

  /**
   * Collects useful replies for one Discourse topic.
   *
   * @param forumUrl Base forum URL.
   * @param topicId Discourse topic identifier.
   * @returns Unified collector comments.
   */
  private async collectTopicReplies(
    forumUrl: string,
    topicId: number,
  ): Promise<CollectorComment[]> {
    if (!topicId) {
      return [];
    }

    try {
      const cacheKey = CollectorCacheUtil.build('forum', 'discourse-replies', [
        forumUrl,
        topicId,
      ]);

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
            externalId: post.id?.toString() ?? '',
            content: this.stripHtml(post.cooked ?? post.excerpt ?? ''),
            author: post.username,
            likesCount: post.like_count ?? 0,
            publishedAt: post.created_at
              ? new Date(post.created_at)
              : undefined,
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
   * Validates a Discourse topic before mapping.
   *
   * @param topic Discourse topic.
   * @returns True when the topic contains valid data.
   */
  private isValidTopic(topic: DiscourseTopic): boolean {
    const title = this.normalizeText(topic.title ?? '');

    if (!topic.id || !topic.slug || !title) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => title.includes(word));
  }

  /**
   * Filters short, low-value, system, or blocked replies.
   *
   * @param post Discourse reply.
   * @returns True when the reply is useful.
   */
  private isUsefulReply(post: DiscourseReply): boolean {
    const content = this.normalizeText(
      this.stripHtml(post.cooked ?? post.excerpt ?? ''),
    );

    if (!post.id || content.length < 30) {
      return false;
    }

    const cleaned = content.replace(/[^\p{L}\p{N}\s+]/gu, '').trim();

    if (!cleaned) {
      return false;
    }

    const author = this.normalizeText(post.username ?? '');

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

    return !blockedWords.some((word) => content.includes(word));
  }

  /**
   * Reads common blocked words and
   * forum-specific blocked words.
   *
   * @returns Normalized blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('FORUM_BLOCKED_WORDS');
  }

  /**
   * Builds headers for public forum requests.
   *
   * @returns HTTP request headers.
   */
  private buildHeaders(): Record<string, string> {
    return {
      ...CollectorHeaderUtil.json(),
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
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

    return 'Unknown Discourse forum error.';
  }
}
