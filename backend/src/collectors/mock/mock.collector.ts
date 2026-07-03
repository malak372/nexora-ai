import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { SocialCollector } from '../base/collector.interface';
import { CollectorInput, CollectorPost } from '../base/collector.types';

/**
 * Mock collector used for development, testing, and demo purposes.
 *
 * This collector does not call external APIs.
 * It generates deterministic sample posts and comments based on the selected
 * domain and optional location filters.
 *
 * @author Malak
 */
@Injectable()
export class MockCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.MOCK;

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    const now = new Date();
    const regionLabel =
      input.region ?? input.city ?? input.country ?? 'unspecified region';

    return [
      {
        sourceType: CollectionSourceType.MOCK,
        platformName: 'Mock',
        externalId: this.buildExternalId('post-1', input),
        title: `${input.domainName} community problem in ${regionLabel}`,
        content: `People in ${regionLabel} are discussing repeated problems related to ${input.domainName}.`,
        author: 'mock_user_1',
        url: 'https://example.com/mock-post-1',
        country: input.country,
        city: input.city,
        region: input.region,
        language: input.language ?? 'en',
        likesCount: 18,
        repliesCount: 2,
        publishedAt: now,
        comments: [
          {
            externalId: this.buildExternalId('comment-1', input),
            content: `We need a practical software solution for ${input.domainName} problems in ${regionLabel}.`,
            author: 'mock_commenter_1',
            language: input.language ?? 'en',
            likesCount: 5,
            publishedAt: now,
          },
          {
            externalId: this.buildExternalId('comment-2', input),
            content: `The current process is slow and people keep asking for a digital platform.`,
            author: 'mock_commenter_2',
            language: input.language ?? 'en',
            likesCount: 7,
            publishedAt: now,
          },
        ],
      },
      {
        sourceType: CollectionSourceType.MOCK,
        platformName: 'Mock',
        externalId: this.buildExternalId('post-2', input),
        title: `Need for better ${input.domainName} services`,
        content: `Users mentioned missing features, poor accessibility, and lack of local digital tools.`,
        author: 'mock_user_2',
        url: 'https://example.com/mock-post-2',
        country: input.country,
        city: input.city,
        region: input.region,
        language: input.language ?? 'en',
        likesCount: 25,
        repliesCount: 2,
        publishedAt: now,
        comments: [
          {
            externalId: this.buildExternalId('comment-3', input),
            content: `A mobile app could help users report issues and track service requests.`,
            author: 'mock_commenter_3',
            language: input.language ?? 'en',
            likesCount: 10,
            publishedAt: now,
          },
          {
            externalId: this.buildExternalId('comment-4', input),
            content: `It would be useful if the system provides recommendations based on real feedback.`,
            author: 'mock_commenter_4',
            language: input.language ?? 'en',
            likesCount: 8,
            publishedAt: now,
          },
        ],
      },
    ];
  }

  /**
   * Builds a stable external ID so repeated mock collection does not create duplicates.
   */
  private buildExternalId(prefix: string, input: CollectorInput): string {
    return [
      'mock',
      prefix,
      input.domainName,
      input.country ?? 'any-country',
      input.city ?? 'any-city',
      input.region ?? 'any-region',
      input.language ?? 'any-language',
      ...(input.keywords ?? []),
    ]
      .join('-')
      .toLowerCase()
      .replace(/\s+/g, '-');
  }
}