import { CollectorCollectionMode, CollectorInput, CollectorPost } from './collector.types';

export type CollectorRequestSupportInput = {
  readonly requestDescription?: string | null;
  readonly domainName?: string | null;
  readonly domainKeywords?: readonly string[];
  readonly keywords?: readonly string[];
  readonly plannedQueries?: readonly string[];
  readonly sourceHints?: readonly string[];
  readonly collectionMode?: CollectorCollectionMode;
};

/**
 * Base contract implemented by every data collector.
 *
 * Each collector exposes a stable sourceKey that must match
 * the corresponding DataSource.key stored in the database.
 *
 * Examples:
 * - youtube
 * - github
 * - app-store
 * - google-play
 * - dev-to
 *
 * Adding a new collector does not require:
 * - Adding a Prisma enum value.
 * - Updating a centralized platform enum.
 * - Updating a platform-name mapping.
 *
 * A new collector only needs to:
 * - Implement this interface.
 * - Be registered as a NestJS provider.
 * - Be registered in CollectorsFactory.
 * - Have a matching DataSource database row.
 *
 * @author Malak
 */
export interface SocialCollector {
  /**
   * Stable backend registry key.
   *
   * The value is normalized by CollectorsFactory before lookup,
   * but collectors should define it using lowercase kebab-case.
   *
   * Must match DataSource.key.
   *
   * Examples:
   * - youtube
   * - github
   * - hacker-news
   * - product-hunt
   */
  readonly sourceKey: string;

  /**
   * Returns whether this collector can execute with the current runtime
   * configuration. Collectors that do not need credentials can omit this
   * method and are treated as available.
   */
  isRuntimeAvailable?(): boolean;

  /**
   * Optional human-readable reason used for diagnostics when a collector is
   * implemented but unavailable because required runtime configuration is
   * missing.
   */
  getRuntimeUnavailableReason?(): string | null;

  /**
   * Optional request-aware availability check. A collector can be globally
   * executable while having no concrete endpoint/community that is appropriate
   * for a particular request. Automatic generation uses this hook to avoid
   * spending a bounded source slot on a guaranteed-zero route.
   */
  supportsRequest?(input: CollectorRequestSupportInput): boolean;

  /**
   * Collects and normalizes public posts and comments
   * from the external data source.
   *
   * @param input Collection request configuration.
   * @returns Unified collected posts.
   */
  collect(input: CollectorInput): Promise<CollectorPost[]>;

  /**
   * Runs a collection operation with request-scoped limits.
   * Implemented centrally by BaseCollector so singleton collectors remain
   * concurrency-safe while all active sources honour FAST_GENERATION limits.
   */
  runWithLimits<T>(
    input: CollectorInput,
    operation: () => Promise<T>,
  ): Promise<T>;
}