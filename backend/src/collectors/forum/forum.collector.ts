import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

import { ForumAdapter } from './adapters/forum-adapter.interface';
import { DiscourseForumAdapter } from './adapters/discourse-forum.adapter';

/**
 * Generic forum collector.
 *
 * Collects public discussions and replies from supported forum engines.
 *
 * Current supported engine:
 * - Discourse
 *
 * Future supported engines:
 * - phpBB
 * - NodeBB
 * - Flarum
 * - Vanilla
 *
 * @author Malak
 */
@Injectable()
export class ForumCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.FORUM;

  private readonly forumSources: {
    url: string;
    adapter: ForumAdapter;
  }[];

  constructor(
    configService: ConfigService,
    private readonly discourseForumAdapter: DiscourseForumAdapter,
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

      const rankedPosts = this.rankAndDeduplicatePosts(collectedPosts, input);

      this.logger.log(
        `Forum collection completed. Posts: ${rankedPosts.length}`,
      );

      return rankedPosts;
    } catch (error: any) {
      this.logger.warn('Forum collection failed', error?.message ?? error);
      return [];
    }
  }

  private rankAndDeduplicatePosts(
    posts: CollectorPost[],
    input: CollectorInput,
  ): CollectorPost[] {
    const seenPostIds = new Set<string>();

    return posts
      .filter((post) => {
        const key = `${post.platformName}-${post.url}-${post.externalId}`;

        if (seenPostIds.has(key)) return false;

        seenPostIds.add(key);
        return true;
      })
      .map((post) => ({
        post,
        score: this.calculatePostRelevanceScore(post, input),
      }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxSavedPosts)
      .map((item) => item.post);
  }

  private buildSearchQuery(input: CollectorInput): string {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([...domainKeywords, ...fallbackDomain, ...userKeywords])
      .slice(0, 4)
      .join(' ');
  }

  private calculatePostRelevanceScore(
    post: CollectorPost,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post.title ?? '',
      body: post.content ?? '',
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.likesCount ?? 0,
      replies: post.repliesCount ?? 0,
      publishedAt: post.publishedAt,
    });
  }

  protected getBlockedWords(): string[] {
    return super.getBlockedWords('FORUM_BLOCKED_WORDS');
  }
}