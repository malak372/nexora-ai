import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import type { SelectedIdeaDataSource } from '../types/idea-generation-context.type';

type ResolveIdeaGenerationSelectionInput = {
  readonly domainId: string;
};

type IdeaGenerationSelectionResult = {
  readonly domain: {
    readonly id: string;
    readonly name: string;
    readonly keywords: string[];
  };
  readonly dataSources: SelectedIdeaDataSource[];
};

/**
 * Resolves the active domain and data sources for an idea-generation run.
 *
 * Responsibilities:
 * - Verify that the requested domain exists and is active.
 * - Load and normalize configured domain keywords.
 * - Select every active and implemented data source automatically.
 * - Keep source-selection policy internal so callers cannot weaken coverage.
 *
 * This service performs selection only. It does not execute collectors or
 * create collection jobs.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSelection(
    input: ResolveIdeaGenerationSelectionInput,
  ): Promise<IdeaGenerationSelectionResult> {
    const domain = await this.prisma.domain.findFirst({
      where: {
        id: input.domainId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        domainKeywords: {
          select: {
            keyword: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!domain) {
      throw new NotFoundException(
        'The selected idea-generation domain was not found or is inactive.',
      );
    }

    const dataSources = await this.prisma.dataSource.findMany({
      where: {
        isActive: true,
        isImplemented: true,
      },
      select: {
        id: true,
        key: true,
        displayName: true,
        supportsPosts: true,
        supportsComments: true,
        supportsRegion: true,
        supportsLanguage: true,
      },
      orderBy: [{ displayName: 'asc' }, { key: 'asc' }],
    });

    if (dataSources.length === 0) {
      throw new BadRequestException(
        'No active and implemented data sources are available for idea generation.',
      );
    }

    return {
      domain: {
        id: domain.id,
        name: domain.name,
        keywords: this.normalizeKeywords(
          domain.domainKeywords.map((item) => item.keyword),
        ),
      },
      dataSources: this.selectFastEvidenceSources(dataSources),
    };
  }

  /**
   * Keeps the collection phase inside the one-minute application budget by
   * selecting a bounded, provider-diverse set of evidence-rich sources.
   */
  private selectFastEvidenceSources<T extends { readonly key: string }>(
    sources: readonly T[],
  ): T[] {
    const priority = [
      'reddit',
      'stack-overflow',
      'github',
      'hacker-news',
      'dev-to',
      'product-hunt',
      'google-play',
      'app-store',
      'youtube',
      'forum',
      'news',
      'blog',
    ];
    const rank = new Map(priority.map((key, index) => [key, index]));

    return [...sources]
      .sort((left, right) =>
        (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, 4);
  }

  private normalizeKeywords(keywords: readonly string[]): string[] {
    return [
      ...new Set(
        keywords
          .map((keyword) => keyword.trim().toLowerCase())
          .filter((keyword) => keyword.length > 0),
      ),
    ];
  }
}