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
    const [domain, dataSources] = await Promise.all([
      this.prisma.domain.findFirst({
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
      }),
      this.prisma.dataSource.findMany({
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
      }),
    ]);

    if (!domain) {
      throw new NotFoundException(
        'The selected idea-generation domain was not found or is inactive.',
      );
    }

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
      dataSources: this.selectAllEvidenceSources(dataSources),
    };
  }

  /**
   * Keeps every active and implemented collector in the initial run.
   *
   * Collectors already execute concurrently through CollectorQueueService, so
   * coverage is preserved without forcing a sequential source wave. Runtime
   * optimization belongs in per-collector timeouts/cache and in downstream
   * recovery decisions, not in silently dropping evidence sources.
   */
  private selectAllEvidenceSources<T extends { readonly key: string }>(
    sources: readonly T[],
  ): T[] {
    const priority = [
      'youtube',
      'google-play',
      'app-store',
      'github',
      'stackoverflow',
      'dev-to',
      'reddit',
      'hacker-news',
      'product-hunt',
      'forum',
      'news',
      'blog',
    ];
    const rank = new Map(priority.map((key, index) => [key, index]));

    return [...sources].sort(
      (left, right) =>
        (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER),
    );
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