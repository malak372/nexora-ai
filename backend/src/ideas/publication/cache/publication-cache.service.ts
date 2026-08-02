import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

/**
 * Stores the current discovery-cache version.
 *
 * Incrementing this value invalidates all discovery and dashboard cache keys
 * that were generated using an older version, without requiring a full cache scan.
 */
const DISCOVERY_CACHE_VERSION_KEY = 'publications:discovery:version';

/**
 * Default lifetime for cached publication discovery results.
 *
 * The value is expressed in milliseconds and currently equals two minutes.
 */
const DISCOVERY_CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * Provides centralized cache management for publication discovery,
 * dashboard listings, and publication details.
 *
 * The service supports:
 * - Reading and writing typed cache values.
 * - Building deterministic cache keys from request queries.
 * - Separating cached results by scope and user identity.
 * - Version-based invalidation for discovery and dashboard data.
 * - Direct invalidation of individual publication-detail entries.
 *
 * Version-based invalidation is used because discovery queries may produce
 * many different cache keys based on filters, pagination, sorting, and user
 * identity. Instead of locating and deleting every matching key, the global
 * version is incremented. Future requests then generate keys under the new
 * version and automatically stop using older cached results.
 *
 * @author Eman
 */
@Injectable()
export class PublicationCacheService {
    /**
     * Creates a new publication cache service.
     *
     * @param cacheManager - NestJS cache manager used to read, write,
     * delete, and version cached publication data.
     */
    constructor(
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) { }

    /**
     * Retrieves a cached value by its exact key.
     *
     * The generic type allows callers to preserve the expected type of the
     * cached response without performing manual casting outside this service.
     *
     * @typeParam T - Expected type of the cached value.
     * @param key - Exact cache key to retrieve.
     * @returns The cached value when found, otherwise `undefined`.
     *
     * @example
     * ```ts
     * const publications =
     *   await publicationCacheService.get<PublicationDto[]>(cacheKey);
     * ```
     */
    async get<T>(key: string): Promise<T | undefined> {
        return this.cacheManager.get<T>(key);
    }

    /**
     * Stores a value in the cache using the default publication-discovery TTL.
     *
     * Cached data expires automatically after two minutes. This keeps frequently
     * requested discovery and dashboard data responsive while limiting the risk
     * of serving outdated publication information for an extended period.
     *
     * @typeParam T - Type of the value being cached.
     * @param key - Exact key under which the value will be stored.
     * @param value - Data to cache.
     *
     * @example
     * ```ts
     * await publicationCacheService.set(cacheKey, response);
     * ```
     */
    async set<T>(key: string, value: T): Promise<void> {
        await this.cacheManager.set(key, value, DISCOVERY_CACHE_TTL_MS);
    }

    /**
     * Retrieves the current discovery-cache version.
     *
     * Version `1` is used as the initial fallback when no version has been
     * stored yet. The version is included in generated cache keys so that
     * incrementing it invalidates all previously generated discovery keys.
     *
     * @returns The active discovery-cache version.
     */
    async getVersion(): Promise<number> {
        return (
            (await this.cacheManager.get<number>(DISCOVERY_CACHE_VERSION_KEY)) ?? 1
        );
    }

    /**
     * Builds a deterministic and versioned cache key.
     *
     * The resulting key includes:
     * - The publication namespace.
     * - The requested cache scope.
     * - The current discovery-cache version.
     * - The requesting user's or guest's identity.
     * - A stable serialized representation of the query.
     *
     * Query-object keys are sorted before serialization. Therefore, logically
     * equivalent query objects produce the same cache key even when their
     * properties were provided in a different order.
     *
     * @param scope - Logical cache area, such as `discovery` or `dashboard`.
     * @param identity - Identity used to separate public, guest, and user data.
     * @param query - Filters, pagination, sorting, or other request parameters.
     * @returns A deterministic cache key for the supplied request context.
     *
     * @example
     * ```ts
     * const cacheKey = await publicationCacheService.buildKey(
     *   'discovery',
     *   'public',
     *   {
     *     page: 1,
     *     limit: 12,
     *     domainId: selectedDomainId,
     *   },
     * );
     * ```
     */
    async buildKey(
        scope: string,
        identity: string,
        query: unknown,
    ): Promise<string> {
        const version = await this.getVersion();
        const normalizedQuery = this.stableStringify(query);

        return `publications:${scope}:v${version}:${identity}:${normalizedQuery}`;
    }

    /**
     * Invalidates cached discovery and dashboard results.
     *
     * The method increments the global discovery-cache version. All future
     * discovery and dashboard requests will therefore use newly generated keys,
     * while older entries become unreachable and expire naturally according to
     * their configured TTL.
     *
     * When a publication ID is supplied, the method also removes the known
     * cache entries for that publication's public and authenticated detail views.
     *
     * This method should be called after operations that can change information
     * displayed in discovery, dashboards, or publication-details pages, including:
     * - Publishing or unpublishing an idea.
     * - Updating publication information.
     * - Deleting a publication.
     * - Changing publication visibility or interaction settings.
     * - Adding or changing votes, ratings, or feedback when totals are displayed.
     *
     * @param publicationId - Optional publication whose detail caches must also
     * be deleted directly.
     *
     * @example
     * ```ts
     * await publicationCacheService.invalidateDiscovery(publication.id);
     * ```
     */
    async invalidateDiscovery(publicationId?: string): Promise<void> {
        const currentVersion = await this.getVersion();

        await this.cacheManager.set(
            DISCOVERY_CACHE_VERSION_KEY,
            currentVersion + 1,
            0,
        );

        if (publicationId) {
            await Promise.all([
                this.cacheManager.del(
                    `publications:public-detail:${publicationId}`,
                ),
                this.cacheManager.del(`publications:detail:${publicationId}`),
            ]);
        }
    }

    /**
     * Serializes a value into a stable JSON-like string.
     *
     * Unlike the standard `JSON.stringify`, object properties are sorted
     * alphabetically before serialization. This guarantees that objects with
     * identical values but different property insertion orders produce the
     * same result.
     *
     * Arrays preserve their original order because array order may carry
     * semantic meaning in filters and query parameters.
     *
     * @param value - Value to serialize.
     * @returns A deterministic serialized representation of the value.
     *
     * @example
     * ```ts
     * stableStringify({ page: 1, limit: 10 });
     * stableStringify({ limit: 10, page: 1 });
     *
     * // Both calls produce the same serialized value.
     * ```
     */
    private stableStringify(value: unknown): string {
        if (!value || typeof value !== 'object') {
            return JSON.stringify(value ?? null);
        }

        if (Array.isArray(value)) {
            return `[${value
                .map((item) => this.stableStringify(item))
                .join(',')}]`;
        }

        const record = value as Record<string, unknown>;

        return `{${Object.keys(record)
            .sort()
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${this.stableStringify(record[key])}`,
            )
            .join(',')}}`;
    }
}