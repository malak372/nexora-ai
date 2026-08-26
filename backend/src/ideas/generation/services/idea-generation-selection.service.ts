import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { CollectorsFactory } from '../../../collectors/collectors.factory';
import type { SelectedIdeaDataSource } from '../types/idea-generation-context.type';
import { IdeaGenerationDatabaseRetryService } from './idea-generation-database-retry.service';
import { isTransientDatabaseError } from '../utils/transient-database-error.util';

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
export class IdeaGenerationSelectionService implements OnModuleInit {
  private readonly logger = new Logger(IdeaGenerationSelectionService.name);
  private collectorRegistrySyncedAt = 0;
  private collectorRegistrySyncPromise: Promise<void> | null = null;
  private static readonly COLLECTOR_REGISTRY_SYNC_TTL_MS = 10 * 60 * 1000;
  private static readonly SELECTION_CACHE_TTL_MS = 2 * 60 * 1000;
  private readonly selectionCache = new Map<
    string,
    { readonly expiresAt: number; readonly value: IdeaGenerationSelectionResult }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly collectorsFactory: CollectorsFactory,
    private readonly databaseRetry: IdeaGenerationDatabaseRetryService,
  ) {}

  onModuleInit(): void {
    setImmediate(() => {
      void this.ensureRuntimeCollectorRegistrySynced().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug(`Collector registry warm-up skipped non-fatally: ${message}`);
      });
    });
  }

  async resolveSelection(
    input: ResolveIdeaGenerationSelectionInput,
  ): Promise<IdeaGenerationSelectionResult> {
    const cached = this.selectionCache.get(input.domainId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        domain: { ...cached.value.domain, keywords: [...cached.value.domain.keywords] },
        dataSources: cached.value.dataSources.map((source) => ({ ...source })),
      };
    }
    if (cached) this.selectionCache.delete(input.domainId);

    // Runtime-registry repair is a deployment self-heal, not a user-request
    // prerequisite. Warm it in parallel and only await it when the normal read
    // proves that no usable collector rows exist.
    void this.ensureRuntimeCollectorRegistrySynced().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Background collector-registry self-heal deferred: ${message}`);
    });
    const runtimeAvailableKeys =
      this.collectorsFactory.getRuntimeAvailableSourceKeys();

    let [domain, dataSources] = await this.databaseRetry.execute(
      () =>
        Promise.all([
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
              key: { in: runtimeAvailableKeys },
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
        ]),
      {
        operationName: 'resolve idea-generation domain and data sources',
      },
    );

    if (!domain) {
      throw new NotFoundException(
        'The selected idea-generation domain was not found or is inactive.',
      );
    }

    if (dataSources.length === 0) {
      await this.ensureRuntimeCollectorRegistrySynced();
      dataSources = await this.databaseRetry.execute(
        () =>
          this.prisma.dataSource.findMany({
            where: {
              isActive: true,
              isImplemented: true,
              key: { in: runtimeAvailableKeys },
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
        { operationName: 'resolve repaired idea-generation data sources' },
      );
      if (dataSources.length === 0) {
        throw new BadRequestException(
          'No active, implemented, and runtime-configured data sources are available for idea generation.',
        );
      }
    }

    const value: IdeaGenerationSelectionResult = {
      domain: {
        id: domain.id,
        name: domain.name,
        keywords: this.sanitizePersistentDomainKeywords(
          domain.name,
          domain.domainKeywords.map((item) => item.keyword),
        ),
      },
      dataSources: this.selectAllEvidenceSources(dataSources),
    };
    this.selectionCache.set(input.domainId, {
      expiresAt: Date.now() + IdeaGenerationSelectionService.SELECTION_CACHE_TTL_MS,
      value,
    });
    return {
      domain: { ...value.domain, keywords: [...value.domain.keywords] },
      dataSources: value.dataSources.map((source) => ({ ...source })),
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

  /**
   * Reconciles the persisted source registry with collectors deployed in this
   * backend. Migrations remain the source of truth for normal deployment, but
   * this lightweight cached repair prevents a missed seed/migration from
   * silently removing working collectors from generation.
   *
   * Existing administrator-disabled sources are preserved. Only the impossible
   * stale state `isActive=true/isImplemented=false` is repaired for a runtime
   * collector; missing built-in public collectors are created active once.
   */
  private async ensureRuntimeCollectorRegistrySynced(): Promise<void> {
    const now = Date.now();
    if (
      now - this.collectorRegistrySyncedAt <
      IdeaGenerationSelectionService.COLLECTOR_REGISTRY_SYNC_TTL_MS
    ) {
      return;
    }

    if (this.collectorRegistrySyncPromise) {
      return this.collectorRegistrySyncPromise;
    }

    this.collectorRegistrySyncPromise = (async () => {
      const implementedKeys = this.collectorsFactory.getImplementedSourceKeys();

      const builtIns = [
        {
          key: 'reddit',
          displayName: 'Reddit',
          description:
            'Collects public Reddit discussions through OAuth when configured, with public read-only RSS fallback when OAuth is unavailable.',
          supportsPosts: true,
          supportsComments: true,
          supportsRegion: false,
          supportsLanguage: true,
        },
        {
          key: 'gdelt',
          displayName: 'GDELT',
          description:
            'Collects public news reports through the no-auth GDELT DOC API.',
          supportsPosts: true,
          supportsComments: false,
          supportsRegion: true,
          supportsLanguage: true,
        },
        {
          key: 'crossref',
          displayName: 'Crossref Research',
          description:
            'Collects public scholarly metadata and abstracts from the Crossref REST API for evidence discovery.',
          supportsPosts: true,
          supportsComments: false,
          supportsRegion: false,
          supportsLanguage: true,
        },
      ] as const;

      const deployableBuiltIns = builtIns.filter((source) =>
        implementedKeys.includes(source.key),
      );

      const staleReddit = await this.databaseRetry.execute(
        () =>
          this.prisma.dataSource.findUnique({
            where: { key: 'reddit' },
            select: {
              isActive: true,
              isImplemented: true,
              description: true,
            },
          }),
        { operationName: 'inspect runtime collector registry' },
      );

      /*
       * Older deployments seeded Reddit as a reserved unavailable source.
       * Repair only that recognizable stale bootstrap state. A source that an
       * administrator disabled after the collector became implemented keeps
       * its explicit isActive=false setting.
       */
      const staleReservedReddit =
        staleReddit != null &&
        !staleReddit.isImplemented &&
        /reserved data source|currently unavailable/iu.test(
          staleReddit.description ?? '',
        );

      await this.databaseRetry.execute(
        () =>
          Promise.all([
            this.prisma.dataSource.updateMany({
              where: {
                key: { in: implementedKeys },
                isImplemented: false,
              },
              data: { isImplemented: true },
            }),
            staleReservedReddit
              ? this.prisma.dataSource.update({
                  where: { key: 'reddit' },
                  data: {
                    isActive: true,
                    isImplemented: true,
                    description:
                      'Collects public Reddit discussions through OAuth when configured, with public read-only RSS fallback when OAuth is unavailable.',
                  },
                })
              : Promise.resolve(null),
            this.prisma.dataSource.createMany({
              data: deployableBuiltIns.map((source) => ({
                ...source,
                isActive: true,
                isImplemented: true,
              })),
              skipDuplicates: true,
            }),
          ]),
        { operationName: 'synchronize runtime collector registry' },
      );

      this.collectorRegistrySyncedAt = Date.now();
    })()
      .catch((error: unknown) => {
        /*
         * Registry reconciliation is a deployment self-heal, not a required
         * generation read. If the database is transiently unavailable after
         * bounded retries, let resolveSelection perform its normal retried read
         * instead of failing the whole data-source-selection stage here.
         */
        if (isTransientDatabaseError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Runtime collector registry sync deferred after transient database failure: ${message}`,
          );
          return;
        }
        throw error;
      })
      .finally(() => {
        this.collectorRegistrySyncPromise = null;
      });

    return this.collectorRegistrySyncPromise;
  }

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
      'forum',
      'hacker-news',
      'product-hunt',
      'news',
      'gdelt',
      'crossref',
      'blog',
    ];
    const rank = new Map(priority.map((key, index) => [key, index]));

    return [...sources].sort(
      (left, right) =>
        (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  private sanitizePersistentDomainKeywords(
    domainName: string,
    keywords: readonly string[],
  ): string[] {
    const normalizedDomain = domainName
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const broadVisibleDomains = new Set([
      'transportation',
      'environment',
      'artificial intelligence',
      'cybersecurity',
      'internet of things',
      'energy',
      'government',
      'healthcare',
      'logistics',
      'food restaurants',
      'hr recruitment',
      'legaltech',
      'finance',
      'real estate',
      'agriculture',
      'e commerce',
    ]);

    const normalizedKeywords = this.normalizeKeywords(keywords);
    if (!broadVisibleDomains.has(normalizedDomain)) {
      return normalizedKeywords;
    }

    const sentenceLike =
      /\b(?:often|usually|frequently|commonly|struggle|struggles|increasingly|may struggle|can lead|making it difficult|coordination or record gap|agencies reduce|providers increasingly|delayed decisions? about|become overloaded)\b/iu;
    const generatedOutcome =
      /^(?:longer journeys?|unnecessary fuel consumption|higher emissions?|delayed customer orders?|incorrect replacements?|mismatched materials?|lost details?|wasted materials?|repeated work)$/iu;

    return normalizedKeywords.filter((keyword) => {
      if (sentenceLike.test(keyword) || generatedOutcome.test(keyword)) {
        return false;
      }
      return keyword.split(/\s+/u).length <= 4;
    });
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