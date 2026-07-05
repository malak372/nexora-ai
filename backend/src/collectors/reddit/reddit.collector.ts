import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';
import axios from 'axios';

import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';

/**
 * Reddit public JSON collector.
 *
 * Collects public Reddit posts using Reddit JSON endpoints.
 * This collector does not require CLIENT_ID or CLIENT_SECRET.
 *
 * Limitations:
 * - Works only with publicly available Reddit content.
 * - Does not access private messages, private subreddits, or user-sensitive data.
 * - Reddit may rate-limit or block requests if abused.
 *
 * @author Malak
 */
@Injectable()
export class RedditCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.REDDIT;

  private readonly userAgent =
    process.env.REDDIT_USER_AGENT ??
    'NexoraAI/1.0.0 academic-project public-data-collector';

  /**
   * Collects public Reddit posts related to the selected domain, location,
   * and keywords.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const query = this.buildSearchQuery(input);

    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(
      query,
    )}&sort=relevance&limit=10&type=link`;

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        timeout: 15000,
      });

      const children = response.data?.data?.children ?? [];

      const posts: CollectorPost[] = [];

      for (const child of children) {
        const redditPost = child?.data;

        if (!redditPost?.id || !redditPost?.permalink) {
          continue;
        }

        const comments = await this.collectPostComments(
          redditPost.permalink,
          input.language,
        );

        posts.push({
          sourceType: CollectionSourceType.REDDIT,
          platformName: 'Reddit',
          externalId: redditPost.id,
          title: redditPost.title,
          content: this.buildPostContent(redditPost),
          author: redditPost.author,
          url: `https://www.reddit.com${redditPost.permalink}`,
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
    } catch {
      throw new ServiceUnavailableException(
        'Reddit public collection failed. Reddit may be rate-limiting public JSON requests.',
      );
    }
  }

  /**
   * Collects public comments for a Reddit post using its permalink.
   */
  private async collectPostComments(permalink: string, language?: string) {
    const commentsUrl = `https://www.reddit.com${permalink}.json?limit=10`;

    try {
      const response = await axios.get(commentsUrl, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        timeout: 15000,
      });

      const commentChildren = response.data?.[1]?.data?.children ?? [];

      return commentChildren
        .map((child: any) => child?.data)
        .filter((comment: any) => {
          return (
            comment?.id &&
            comment?.body &&
            comment.body !== '[deleted]' &&
            comment.body !== '[removed]'
          );
        })
        .slice(0, 10)
        .map((comment: any) => ({
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

  /**
   * Builds a readable post content value from Reddit post fields.
   */
  private buildPostContent(post: any): string {
    return [post.title, post.selftext].filter(Boolean).join('\n\n');
  }

  /**
   * Builds Reddit search query from domain, location, and keywords.
   */
  private buildSearchQuery(input: CollectorInput): string {
    return [
      input.domainName,
      ...(input.domainKeywords ?? []),
      ...(input.keywords ?? []),
      input.country,
      input.city,
      input.region,
    ]
      .filter(Boolean)
      .join(' ');
  }
}