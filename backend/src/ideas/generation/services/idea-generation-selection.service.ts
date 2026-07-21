import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';

import { IDEA_GENERATION_ERROR_CODES } from '../constants/idea-generation.constants';

import type { SelectedIdeaDataSource } from '../types/idea-generation-context.type';

/**
 * Input required to resolve the domain and data sources used
 * by one idea-generation run.
 *
 * @author Malak
 */
export type ResolveIdeaGenerationSourcesInput = {
  /**
   * Identifier of the domain selected by the requester.
   */
  domainId: string;

  /**
   * Optional data-source keys selected by the requester.
   *
   * When omitted or empty, all active and implemented data
   * sources are selected.
   */
  requestedDataSourceKeys?: string[];
};

/**
 * Validated domain information required by the generation
 * pipeline.
 *
 * @author Malak
 */
export type ResolvedIdeaGenerationDomain = {
  /**
   * Unique domain identifier.
   */
  id: string;

  /**
   * Human-readable domain name.
   */
  name: string;

  /**
   * Normalized keywords configured for the domain.
   */
  keywords: string[];
};

/**
 * Result returned after resolving the domain and applicable
 * data sources.
 *
 * @author Malak
 */
export type IdeaGenerationSelectionResult = {
  /**
   * Validated active domain.
   */
  domain: ResolvedIdeaGenerationDomain;

  /**
   * Active and implemented data sources selected for the run.
   */
  dataSources: SelectedIdeaDataSource[];
};

/**
 * Resolves and validates the domain and data sources used by
 * the idea-generation pipeline.
 *
 * Responsibilities:
 * - Ensure that the selected domain exists.
 * - Ensure that the selected domain is active.
 * - Load keywords associated with the domain.
 * - Resolve active and implemented data sources.
 * - Validate explicitly requested data-source keys.
 *
 * This service does not:
 * - Create or execute collection jobs.
 * - Call collector implementations.
 * - Perform NLP analysis.
 * - Generate prompts.
 * - Persist generated ideas.
 *
 * Collector implementations are resolved later through their
 * stable data-source keys.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves both the selected domain and the applicable data
   * sources.
   *
   * Domain and data-source queries are executed concurrently
   * because neither query depends on the result of the other.
   *
   * @param input Domain and optional data-source selection.
   * @returns Validated domain and selected data sources.
   */
  async resolveSelection(
    input: ResolveIdeaGenerationSourcesInput,
  ): Promise<IdeaGenerationSelectionResult> {
    const [domain, dataSources] = await Promise.all([
      this.resolveDomain(input.domainId),
      this.resolveDataSources(input.requestedDataSourceKeys),
    ]);

    return {
      domain,
      dataSources,
    };
  }

  /**
   * Loads and validates an active domain.
   *
   * Domain keywords are returned so the collection stage can
   * combine them with optional requester-provided keywords.
   *
   * The current Prisma schema uses:
   * - Domain as the model name.
   * - domainKeywords as the relation name.
   * - DomainKeyword.keyword as the stored keyword value.
   *
   * @param domainId Domain identifier.
   * @returns Validated domain information.
   */
  async resolveDomain(domainId: string): Promise<ResolvedIdeaGenerationDomain> {
    const domain = await this.prisma.domain.findUnique({
      where: {
        id: domainId,
      },
      select: {
        id: true,
        name: true,
        isActive: true,

        domainKeywords: {
          select: {
            keyword: true,
          },
          orderBy: {
            keyword: 'asc',
          },
        },
      },
    });

    if (!domain) {
      throw new NotFoundException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message: 'The selected domain was not found.',
      });
    }

    if (!domain.isActive) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_INACTIVE,
        message: 'The selected domain is currently inactive.',
      });
    }

    return {
      id: domain.id,
      name: domain.name,
      keywords: this.normalizeValues(
        domain.domainKeywords.map((item) => item.keyword),
      ),
    };
  }

  /**
   * Resolves active and implemented data sources.
   *
   * When the requester supplies source keys, every requested
   * source must:
   * - Exist in the database.
   * - Be active.
   * - Have an implemented collector.
   *
   * The request is rejected when any selected source cannot be
   * resolved. This prevents the system from silently changing
   * the requested collection scope.
   *
   * When no source keys are supplied, all active and implemented
   * data sources are returned.
   *
   * @param requestedDataSourceKeys Optional selected source keys.
   * @returns Available data sources selected for generation.
   */
  async resolveDataSources(
    requestedDataSourceKeys?: string[],
  ): Promise<SelectedIdeaDataSource[]> {
    const normalizedRequestedKeys = this.normalizeValues(
      requestedDataSourceKeys ?? [],
    );

    const dataSources = await this.prisma.dataSource.findMany({
      where: {
        isActive: true,
        isImplemented: true,

        ...(normalizedRequestedKeys.length > 0
          ? {
              key: {
                in: normalizedRequestedKeys,
              },
            }
          : {}),
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
      orderBy: {
        displayName: 'asc',
      },
    });

    if (dataSources.length === 0) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NO_DATA_SOURCES_AVAILABLE,
        message:
          normalizedRequestedKeys.length > 0
            ? 'None of the selected data sources are currently available.'
            : 'No active and implemented data sources are currently available.',
      });
    }

    if (normalizedRequestedKeys.length > 0) {
      this.validateRequestedDataSources(
        normalizedRequestedKeys,
        dataSources.map((dataSource) => dataSource.key),
      );
    }

    return dataSources.map((dataSource) => ({
      id: dataSource.id,
      key: dataSource.key,
      displayName: dataSource.displayName,
      supportsPosts: dataSource.supportsPosts,
      supportsComments: dataSource.supportsComments,
      supportsRegion: dataSource.supportsRegion,
      supportsLanguage: dataSource.supportsLanguage,
    }));
  }

  /**
   * Returns the keys of all currently active and implemented
   * data sources.
   *
   * This method may be reused by:
   * - Request validation.
   * - Administrative monitoring.
   * - Collector diagnostics.
   * - Generation configuration endpoints.
   *
   * @returns Stable available data-source keys.
   */
  async getAvailableDataSourceKeys(): Promise<string[]> {
    const dataSources = await this.prisma.dataSource.findMany({
      where: {
        isActive: true,
        isImplemented: true,
      },
      select: {
        key: true,
      },
      orderBy: {
        key: 'asc',
      },
    });

    return dataSources.map((dataSource) => dataSource.key);
  }

  /**
   * Ensures that every explicitly requested data-source key was
   * successfully resolved.
   *
   * A source is considered unavailable when it:
   * - Does not exist.
   * - Is inactive.
   * - Is not implemented.
   *
   * @param requestedKeys Normalized requested keys.
   * @param resolvedKeys Successfully resolved keys.
   */
  private validateRequestedDataSources(
    requestedKeys: string[],
    resolvedKeys: string[],
  ): void {
    const resolvedKeySet = new Set(
      resolvedKeys.map((key) => key.trim().toLowerCase()),
    );

    const unavailableKeys = requestedKeys.filter(
      (key) => !resolvedKeySet.has(key),
    );

    if (unavailableKeys.length === 0) {
      return;
    }

    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.NO_DATA_SOURCES_AVAILABLE,
      message: 'One or more selected data sources are unavailable.',
      unavailableDataSourceKeys: unavailableKeys,
    });
  }

  /**
   * Normalizes a list of string values.
   *
   * Normalization performs the following operations:
   * - Removes non-string values defensively.
   * - Trims surrounding whitespace.
   * - Converts values to lowercase.
   * - Removes empty values.
   * - Removes duplicate values.
   *
   * The order of the first appearance of each value is
   * preserved.
   *
   * @param values Values to normalize.
   * @returns Normalized unique values.
   */
  private normalizeValues(values: string[]): string[] {
    const normalizedValues = values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    return [...new Set(normalizedValues)];
  }
}
