import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * Product Hunt collector.
 *
 * Collects public Product Hunt posts and comments using Product Hunt API v2.
 *
 * @author Malak
 */
@Injectable()
export class ProductHuntCollector
  extends BaseCollector
  implements SocialCollector
{
  readonly sourceType = CollectionSourceType.PRODUCT_HUNT;

  private readonly platformName = 'Product Hunt';
  private readonly apiUrl = 'https://api.producthunt.com/v2/api/graphql';

  constructor(configService: ConfigService) {
    super(configService, ProductHuntCollector.name);
  }

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

      if (!searchTerms.length) {
        this.logger.warn(
          'Product Hunt collection skipped because no search keywords exist.',
        );
        return [];
      }

      const collectedPosts: any[] = [];

      for (const term of searchTerms) {
        if (collectedPosts.length >= this.maxFetchedPosts) break;

        const posts = await this.searchPosts(term, token);
        collectedPosts.push(...posts);
      }

      const seenPostIds = new Set<string>();

      const rankedPosts = collectedPosts
        .filter((post) => this.isValidPost(post))
        .filter((post) => {
          const id = post?.id?.toString();

          if (!id || seenPostIds.has(id)) return false;

          seenPostIds.add(id);
          return true;
        })
        .map((post) => ({
          post,
          score: this.calculatePostRelevanceScore(post, input),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts)
        .map((item) => this.mapProductToCollectorPost(item.post, input));

      this.logger.log(
        `Product Hunt collection completed. Posts: ${rankedPosts.length}`,
      );

      return rankedPosts;
    } catch (error: any) {
      this.logger.error(
        'Product Hunt collection failed',
        error.response?.data ?? error.message,
      );

      throw new ServiceUnavailableException(
        'Product Hunt collection failed. Check PRODUCT_HUNT_TOKEN, API limits, or network connection.',
      );
    }
  }

  private async searchPosts(term: string, token: string): Promise<any[]> {
    const query = `
      query SearchPosts($term: String!) {
        posts(first: 20, search: $term) {
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
              comments(first: 20) {
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
        }
      }
    `;

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        query,
        variables: {
          term,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Product Hunt API failed with status ${response.status}`);
    }

    const data = await response.json();

    return (
      data?.data?.posts?.edges?.map((edge: any) => edge.node) ?? []
    );
  }

  private buildSearchTerms(input: CollectorInput): string[] {
    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    return this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ])
      .filter((term) => term.length >= 3)
      .slice(0, 6);
  }

  private isValidPost(post: any): boolean {
    const title = post?.name ?? '';
    const body = `${post?.tagline ?? ''} ${post?.description ?? ''}`;
    const content = this.normalizeText(`${title} ${body}`);
    const blockedWords = this.getBlockedWords();

    if (!post?.id || !title || content.length < 20) {
      return false;
    }

    return !blockedWords.some((word) => content.includes(word));
  }

  private calculatePostRelevanceScore(
    post: any,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post?.name ?? '',
      body: `${post?.tagline ?? ''} ${post?.description ?? ''}`,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post?.votesCount ?? 0,
      replies: post?.commentsCount ?? 0,
      publishedAt: post?.createdAt ? new Date(post.createdAt) : undefined,
    });
  }

  private mapProductToCollectorPost(
    post: any,
    input: CollectorInput,
  ): CollectorPost {
    const comments = this.collectProductComments(post);

    return {
      sourceType: CollectionSourceType.PRODUCT_HUNT,
      platformName: this.platformName,
      externalId: post.id.toString(),
      title: post.name,
      content: [post.tagline, post.description].filter(Boolean).join('\n\n'),
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

  private collectProductComments(post: any): CollectorComment[] {
    const edges = post?.comments?.edges ?? [];

    return edges
      .map((edge: any) => edge.node)
      .filter((comment: any) => this.isUsefulComment(comment))
      .slice(0, this.maxSavedComments)
      .map((comment: any): CollectorComment => ({
        externalId: comment.id.toString(),
        content: comment.body,
        author: comment.user?.username ?? comment.user?.name,
        likesCount: 0,
        publishedAt: comment.createdAt
          ? new Date(comment.createdAt)
          : undefined,
      }));
  }

  private isUsefulComment(comment: any): boolean {
    const content = this.normalizeText(comment?.body ?? '');

    if (!comment?.id || content.length < 30) {
      return false;
    }

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) => content.includes(word));
  }

  private getToken(): string {
    return this.configService.get<string>('PRODUCT_HUNT_TOKEN') ?? '';
  }

  protected getBlockedWords(): string[] {
    return super.getBlockedWords('PRODUCT_HUNT_BLOCKED_WORDS');
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }
}