import { Logger } from '@nestjs/common';

import { CollectorCacheUtil } from './collector-cache.util';

/**
 * Utility wrapper for caching third-party library calls.
 *
 * Used with:
 * - rss-parser
 * - app-store-scraper
 * - google-play-scraper
 *
 * @author Malak
 */
export class CollectorExternalCacheUtil {
  /**
   * Logger used to report failed external cached calls.
   */
  private static readonly logger = new Logger(CollectorExternalCacheUtil.name);

  /**
   * Returns a cached value when available, otherwise executes
   * the callback and stores its result using the provided TTL.
   *
   * @template T Type of the cached value.
   * @param cacheKey Unique cache key.
   * @param cacheTtlMs Cache lifetime in milliseconds.
   * @param callback External asynchronous operation.
   * @returns The cached or newly fetched result.
   */
  static async remember<T>(
    cacheKey: string,
    cacheTtlMs: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const cached = CollectorCacheUtil.get<T>(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const result = await callback();

      CollectorCacheUtil.set(cacheKey, result, cacheTtlMs);

      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.warn(`External cached call failed: ${errorMessage}`);

      throw error;
    }
  }
}
