import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';

import {
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

import { ForumAdapter } from './adapters/forum-adapter.interface';
import { DiscourseForumAdapter } from './adapters/discourse-forum.adapter';

type ForumSource = {
  url: string;
  adapter: ForumAdapter;
};

/**
 * Generic forum collector.
 *
 * The collector currently supports Discourse forums.
 *
 * @author Malak
 */
@Injectable()
export class ForumCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'forum';

  private readonly forumSources: ForumSource[];

  constructor(
    configService: ConfigService,

    private readonly discourseForumAdapter:
      DiscourseForumAdapter,
  ) {
    super(configService, ForumCollector.name);

    this.forumSources = [
      {
        url: 'https://meta.discourse.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://forum.freecodecamp.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discourse.mozilla.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discourse.ubuntu.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discussion.fedoraproject.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discuss.kubernetes.io',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://community.grafana.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://forums.docker.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discuss.elastic.co',
        adapter: this.discourseForumAdapter,
      },
    ];
  }

  /**
   * Collects posts from configured forum sources.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Forum collection skipped because no search keywords exist.',
        );

        return [];
      }

      const collectedPosts: CollectorPost[] = [];

      for (const source of this.forumSources) {
        const posts = await source.adapter.collect(
          source.url,
          searchQuery,
          input,
        );

        collectedPosts.push(...posts);
      }

      const rankedPosts = this.rankAndDeduplicatePosts(
        collectedPosts,
        input,
      );

      this.logger.log(
        `Forum collection completed. Posts: ${rankedPosts.length}`,
      );

      return rankedPosts;
    } catch (error: unknown) {
      this.logger.warn(
        'Forum collection failed',
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  /**
   * Removes duplicate forum posts and ranks them.
   */
  private rankAndDeduplicatePosts(
    posts: CollectorPost[],
    input: CollectorInput,
  ): CollectorPost[] {
    const seenPostIds = new Set<string>();

    return posts
      .filter((post) => {
        const key = `${post.url ?? ''}-${post.externalId}`;

        if (seenPostIds.has(key)) {
          return false;
        }

        seenPostIds.add(key);

        return true;
      })
      .map((post) => ({
        post,
        score: this.calculatePostRelevanceScore(
          post,
          input,
        ),
      }))
      .filter((item) => item.score >= 3)
      .sort((first, second) => second.score - first.score)
      .slice(0, this.maxSavedPosts)
      .map((item) => item.post);
  }

  /**
   * Builds the forum search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ])
      .slice(0, 4)
      .join(' ');
  }

  /**
   * Calculates forum-post relevance.
   */
  private calculatePostRelevanceScore(
    post: CollectorPost,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post.title,
      body: post.content,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.likesCount ?? 0,
      replies: post.repliesCount ?? 0,
      publishedAt: post.publishedAt,
    });
  }

  /**
   * Reads forum-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('FORUM_BLOCKED_WORDS');
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
      : 'Unknown Forum collector error.';
  }
}