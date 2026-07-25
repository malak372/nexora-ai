import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import type { SelectedIdeaDataSource } from '../types/idea-generation-context.type';

type ResolveIdeaGenerationSelectionInput = {
  readonly domainId: string;
  readonly requestedDataSourceKeys: readonly string[];
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
 * - Resolve explicitly requested active, implemented data sources.
 * - Select every active, implemented source when no keys are supplied.
 * - Reject unknown, inactive, or unimplemented requested source keys.
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
    const requestedKeys = this.normalizeRequestedKeys(
      input.requestedDataSourceKeys,
    );

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
        ...(requestedKeys.length > 0 && {
          key: {
            in: requestedKeys,
          },
        }),
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

    if (requestedKeys.length > 0) {
      this.assertAllRequestedSourcesResolved(requestedKeys, dataSources);
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
      dataSources,
    };
  }

  private normalizeRequestedKeys(keys: readonly string[]): string[] {
    return [
      ...new Set(
        keys
          .map((key) => key.trim().toLowerCase())
          .filter((key) => key.length > 0),
      ),
    ];
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

  private assertAllRequestedSourcesResolved(
    requestedKeys: readonly string[],
    dataSources: readonly SelectedIdeaDataSource[],
  ): void {
    const resolvedKeys = new Set(dataSources.map((source) => source.key));
    const unavailableKeys = requestedKeys.filter(
      (key) => !resolvedKeys.has(key),
    );

    if (unavailableKeys.length === 0) {
      return;
    }

    throw new BadRequestException(
      `The following data source key(s) are unknown, inactive, or not implemented: ${unavailableKeys.join(', ')}.`,
    );
  }
}
