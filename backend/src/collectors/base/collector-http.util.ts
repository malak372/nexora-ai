import {
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

/**
 * HTTP response wrapper used when collectors need both:
 * - Response body data.
 * - Response headers such as ETag and rate limit headers.
 */
export type CollectorHttpResponse<T> = {
  data: T;
  headers: Record<string, any>;
  status: number;
};

/**
 * Shared HTTP utility for all data collectors.
 *
 * Provides:
 * - HTTP GET requests using Axios.
 * - Retry for temporary failures.
 * - Exponential backoff.
 * - Retry-After support.
 * - Simple in-memory caching.
 * - Optional ETag / If-None-Match support.
 * - Response headers access for rate-limit monitoring.
 *
 * @author Malak
 */
export class CollectorHttpUtil {
  private static readonly logger = new Logger(CollectorHttpUtil.name);

  private static readonly cache = new Map<string, CacheEntry<any>>();

  /**
   * Old method kept for backward compatibility.
   *
   * Existing collectors can still use this without changes.
   */
  static async getWithRetryAndCache<T>(
    url: string,
    config: AxiosRequestConfig,
    options: {
      cacheKey: string;
      cacheTtlMs: number;
      retryAttempts: number;
      retryDelayMs: number;
    },
  ): Promise<T> {
    const response = await this.getWithRetryCacheAndHeaders<T>(
      url,
      config,
      options,
    );

    return response.data;
  }

  /**
   * Executes an HTTP GET request with:
   * - Cache.
   * - Retry.
   * - Exponential backoff.
   * - Optional ETag support.
   * - Response headers return.
   *
   * This is useful for APIs like GitHub where we need:
   * - ETag to reduce API usage.
   * - X-RateLimit headers to monitor remaining requests.
   *
   * @template T Response type.
   * @param url Target URL.
   * @param config Axios request config.
   * @param options Cache, retry, and optional ETag options.
   * @returns Data, headers, and status code.
   */
  static async getWithRetryCacheAndHeaders<T>(
    url: string,
    config: AxiosRequestConfig,
    options: {
      cacheKey: string;
      cacheTtlMs: number;
      retryAttempts: number;
      retryDelayMs: number;
      etagCacheKey?: string;
    },
  ): Promise<CollectorHttpResponse<T>> {
    const cachedData = this.cache.get(options.cacheKey);

    if (cachedData && cachedData.expiresAt > Date.now()) {
      this.logger.log(`Cache hit: ${options.cacheKey}`);

      return {
        data: cachedData.data as T,
        headers: {},
        status: 200,
      };
    }

    const cachedEtag = options.etagCacheKey
      ? this.cache.get(options.etagCacheKey)
      : undefined;

    const requestConfig: AxiosRequestConfig = {
      ...config,
      headers: {
        ...(config.headers ?? {}),
        ...(cachedEtag?.data
          ? { 'If-None-Match': cachedEtag.data }
          : {}),
      },
      validateStatus: (status: number) =>
        (status >= 200 && status < 300) || status === 304,
    };

    let lastError: any;

    for (let attempt = 1; attempt <= options.retryAttempts; attempt++) {
      try {
        this.logger.log(`HTTP GET attempt ${attempt}: ${url}`);

        const response: AxiosResponse<T> = await axios.get<T>(
          url,
          requestConfig,
        );

        if (response.status === 304 && cachedData) {
          this.logger.log(`ETag not modified: ${options.cacheKey}`);

          return {
            data: cachedData.data as T,
            headers: response.headers,
            status: response.status,
          };
        }

        this.cache.set(options.cacheKey, {
          data: response.data,
          expiresAt: Date.now() + options.cacheTtlMs,
        });

        const etag = response.headers?.etag;

        if (etag && options.etagCacheKey) {
          this.cache.set(options.etagCacheKey, {
            data: etag,
            expiresAt: Date.now() + options.cacheTtlMs,
          });
        }

        return {
          data: response.data,
          headers: response.headers,
          status: response.status,
        };
      } catch (error: any) {
        lastError = error;

        const status = error.response?.status;
        const retryAfter = Number(
          error.response?.headers?.['retry-after'] ?? 0,
        );

        if (status === 429) {
          this.logger.warn(
            `Rate limit detected for ${url}. Retry-After: ${
              retryAfter || 'not provided'
            } seconds.`,
          );
        }

        if (status === 402) {
          this.logger.error(`API credits depleted for ${url}`);

          throw new ServiceUnavailableException(
            'External API credits are depleted or payment is required.',
          );
        }

        const shouldRetry =
          !status || status === 408 || status === 429 || status >= 500;

        if (!shouldRetry || attempt === options.retryAttempts) {
          this.logger.error(
            `HTTP GET failed: ${url}`,
            error.response?.data ?? error.message,
          );

          if (cachedData) {
            this.logger.warn(
              `Returning stale cached data after request failure: ${options.cacheKey}`,
            );

            return {
              data: cachedData.data as T,
              headers: error.response?.headers ?? {},
              status: status ?? 0,
            };
          }

          throw error;
        }

        const delayMs = this.calculateBackoffDelay(
          options.retryDelayMs,
          attempt,
          retryAfter,
        );

        this.logger.warn(`Retrying in ${delayMs}ms...`);

        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private static calculateBackoffDelay(
    baseDelayMs: number,
    attempt: number,
    retryAfterSeconds: number,
  ): number {
    if (retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    return baseDelayMs * Math.pow(2, attempt - 1);
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}