import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';
import axios from 'axios';

import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';

/**
 * Reddit collector.
 *
 * Collects public Reddit posts using Reddit JSON listing endpoints.
 *
 * Notes:
 * - This implementation is suitable for demo/testing.
 * - Reddit may block unauthenticated JSON access with 403.
 * - A clear User-Agent is required by Reddit best practices.
 *
 * @author Malak
 */
@Injectable()
export class RedditCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.REDDIT;

  private readonly userAgent =
    'NexoraAI/1.0.0 graduation-project data-collection by Malak';

  /**
   * Collects Reddit posts related to selected domain and keywords.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const query = this.buildSearchQuery(input);

    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(
      query,
    )}&sort=relevance&limit=10`;

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        timeout: 10000,
      });

      const children = response.data?.data?.children ?? [];

      return children
        .map((child: any) => child?.data)
        .filter((post: any) => post?.id && (post?.title || post?.selftext))
        .map((post: any): CollectorPost => {
          const content = [post.title, post.selftext]
            .filter(Boolean)
            .join('\n\n');

          return {
            sourceType: CollectionSourceType.REDDIT,
            platformName: 'Reddit',
            externalId: post.id,
            title: post.title,
            content,
            author: post.author,
            url: post.permalink
              ? `https://www.reddit.com${post.permalink}`
              : undefined,
            country: input.country,
            city: input.city,
            region: input.region,
            language: input.language,
            likesCount: post.ups ?? 0,
            repliesCount: post.num_comments ?? 0,
            publishedAt: post.created_utc
              ? new Date(post.created_utc * 1000)
              : undefined,
            comments: [],
          };
        });
    } catch (error) {
      throw new ServiceUnavailableException(
        'Reddit collection failed. Reddit may require official API access or OAuth.',
      );
    }
  }

  /**
   * Builds a Reddit search query from domain, location, and keywords.
   */
  private buildSearchQuery(input: CollectorInput): string {
    return [
      input.domainName,
      input.country,
      input.city,
      input.region,
      ...(input.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ');
  }
}