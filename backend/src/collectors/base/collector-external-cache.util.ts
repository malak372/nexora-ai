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
  private static readonly logger = new Logger(CollectorExternalCacheUtil.name);

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
      this.logger.warn(
        `External cached call failed: ${
          error instanceof Error ? error.message : error
        }`,
      );

      throw error;
    }
  }
}