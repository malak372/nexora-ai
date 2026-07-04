import {
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

/**
 * Shared HTTP utility for all data collectors.
 *
 * Provides:
 * - HTTP GET requests using Axios.
 * - Automatic retry for temporary failures.
 * - Exponential backoff between retries.
 * - Support for Retry-After headers when rate limited.
 * - Simple in-memory response caching.
 * - Logging for requests, retries, cache hits, and failures.
 *
 * This utility helps reduce duplicated HTTP logic across collectors
 * such as GitHub, Reddit, YouTube, X, and other external providers.
 *
 * The cache is process-local and intended for development and
 * graduation-project usage. It is not distributed across multiple
 * application instances.
 *
 * @author Malak
 */
export class CollectorHttpUtil {
  /**
   * Shared logger for collector HTTP operations.
   */
  private static readonly logger = new Logger(CollectorHttpUtil.name);

  /**
   * In-memory cache for HTTP responses.
   *
   * Key: custom cache key.
   * Value: cached response with expiration timestamp.
   */
  private static readonly cache = new Map<string, CacheEntry<any>>();

  /**
   * Executes an HTTP GET request with caching and retry support.
   *
   * Workflow:
   * 1. Returns cached data if available and still valid.
   * 2. Executes the HTTP request.
   * 3. Stores successful responses in cache.
   * 4. Retries temporary failures using exponential backoff.
   * 5. Honors Retry-After headers when provided.
   *
   * @template T Response type.
   * @param url Target request URL.
   * @param config Axios request configuration.
   * @param options Request behavior options.
   * @returns Parsed response data.
   * @throws ServiceUnavailableException When the external API
   * requires payment or available credits have been exhausted.
   * @throws AxiosError When the request ultimately fails.
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
    const cached = this.cache.get(options.cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      this.logger.log(`Cache hit: ${options.cacheKey}`);
      return cached.data as T;
    }

    let lastError: any;

    for (let attempt = 1; attempt <= options.retryAttempts; attempt++) {
      try {
        this.logger.log(`HTTP GET attempt ${attempt}: ${url}`);

        const response = await axios.get<T>(url, config);

        this.cache.set(options.cacheKey, {
          data: response.data,
          expiresAt: Date.now() + options.cacheTtlMs,
        });

        return response.data;
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

  /**
   * Calculates the retry delay.
   *
   * If the external API provides a Retry-After header,
   * that value is used directly.
   *
   * Otherwise, exponential backoff is applied:
   * baseDelay × 2^(attempt - 1)
   *
   * Example:
   * - Attempt 1 → 1000 ms
   * - Attempt 2 → 2000 ms
   * - Attempt 3 → 4000 ms
   * - Attempt 4 → 8000 ms
   *
   * @param baseDelayMs Initial retry delay.
   * @param attempt Current retry attempt.
   * @param retryAfterSeconds Retry-After value returned by the API.
   * @returns Delay in milliseconds.
   */
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

  /**
   * Waits for the specified duration.
   *
   * @param ms Delay in milliseconds.
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}