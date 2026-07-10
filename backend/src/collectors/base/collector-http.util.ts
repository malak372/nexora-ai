import { Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';

/**
 * Represents one cached value and its expiration time.
 *
 * @template T Type of the cached data.
 */
type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

/**
 * Configuration used by HTTP requests with retry and caching.
 */
type CollectorHttpOptions = {
  /**
   * Unique key used to cache the response body.
   */
  cacheKey: string;

  /**
   * Cache lifetime in milliseconds.
   */
  cacheTtlMs: number;

  /**
   * Maximum number of request attempts.
   */
  retryAttempts: number;

  /**
   * Base delay used for exponential backoff.
   */
  retryDelayMs: number;

  /**
   * Optional cache key used to store an ETag value.
   */
  etagCacheKey?: string;
};

/**
 * HTTP response wrapper used when collectors need both:
 * - Response body data.
 * - Response headers such as ETag and rate limit headers.
 */
export type CollectorHttpResponse<T> = {
  data: T;
  headers: Record<string, unknown>;
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
  /**
   * Logger used for request, retry, cache, and error events.
   */
  private static readonly logger = new Logger(CollectorHttpUtil.name);

  /**
   * Shared in-memory collector cache.
   */
  private static readonly cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Executes an HTTP GET request with retry and caching.
   *
   * This method is retained for backward compatibility with
   * collectors that only need the response body.
   *
   * @template T Expected response body type.
   * @param url Target URL.
   * @param config Axios request configuration.
   * @param options Retry and cache options.
   * @returns The response body.
   */
  static async getWithRetryAndCache<T>(
    url: string,
    config: AxiosRequestConfig,
    options: CollectorHttpOptions,
  ): Promise<T> {
    const response = await this.getWithRetryCacheAndHeaders<T>(
      url,
      config,
      options,
    );

    return response.data;
  }

  /**
   * Executes an HTTP GET request with retry, caching,
   * exponential backoff, optional ETag support, and
   * response header access.
   *
   * @template T Expected response body type.
   * @param url Target URL.
   * @param config Axios request configuration.
   * @param options Retry, cache, and optional ETag options.
   * @returns The response body, headers, and status code.
   */
  static async getWithRetryCacheAndHeaders<T>(
    url: string,
    config: AxiosRequestConfig,
    options: CollectorHttpOptions,
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

    const etagValue =
      typeof cachedEtag?.data === 'string' ? cachedEtag.data : undefined;

    const requestConfig: AxiosRequestConfig = {
      ...config,
      timeout: config.timeout ?? 10_000,
      headers: {
        ...(config.headers ?? {}),
        ...(etagValue
          ? {
              'If-None-Match': etagValue,
            }
          : {}),
      },
      validateStatus: (status: number): boolean =>
        (status >= 200 && status < 300) || status === 304,
    };

    const retryAttempts = Math.max(1, options.retryAttempts);

    let lastError: unknown;

    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
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
            headers: this.normalizeHeaders(response.headers),
            status: response.status,
          };
        }

        this.cache.set(options.cacheKey, {
          data: response.data,
          expiresAt: Date.now() + options.cacheTtlMs,
        });

        const etag = this.getHeaderValue(response.headers, 'etag');

        if (etag && options.etagCacheKey) {
          this.cache.set(options.etagCacheKey, {
            data: etag,
            expiresAt: Date.now() + options.cacheTtlMs,
          });
        }

        return {
          data: response.data,
          headers: this.normalizeHeaders(response.headers),
          status: response.status,
        };
      } catch (error: unknown) {
        lastError = error;

        const axiosError = this.getAxiosError(error);

        const status = axiosError?.response?.status;

        const retryAfter = this.getRetryAfterSeconds(axiosError);

        if (status === 429) {
          this.logger.warn(
            `Rate limit detected for ${url}. Retry-After: ${
              retryAfter > 0 ? retryAfter : 'not provided'
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
          status === undefined ||
          status === 408 ||
          status === 429 ||
          status >= 500;

        if (!shouldRetry || attempt === retryAttempts) {
          this.logger.error(
            `HTTP GET failed: ${url}. ${this.getErrorMessage(error)}`,
          );

          if (cachedData) {
            this.logger.warn(
              `Returning stale cached data after request failure: ${options.cacheKey}`,
            );

            return {
              data: cachedData.data as T,
              headers: this.normalizeHeaders(axiosError?.response?.headers),
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

  /**
   * Safely narrows an unknown error to an Axios error.
   *
   * Response data is explicitly typed as unknown to prevent
   * unsafe access to Axios's default any response type.
   *
   * @param error Unknown caught error.
   * @returns The Axios error when applicable.
   */
  private static getAxiosError(
    error: unknown,
  ): AxiosError<unknown> | undefined {
    return axios.isAxiosError<unknown>(error) ? error : undefined;
  }

  /**
   * Reads a response header safely.
   *
   * Supports both AxiosHeaders instances and plain
   * response-header objects.
   *
   * @param headers Unknown Axios response headers.
   * @param headerName Header name to retrieve.
   * @returns The normalized header value when available.
   */
  private static getHeaderValue(
    headers: unknown,
    headerName: string,
  ): string | undefined {
    if (headers instanceof AxiosHeaders) {
      const value: unknown = headers.get(headerName);

      return this.normalizeHeaderValue(value);
    }

    if (typeof headers !== 'object' || headers === null) {
      return undefined;
    }

    const headerRecord = headers as Record<string, unknown>;

    return this.normalizeHeaderValue(headerRecord[headerName]);
  }

  /**
   * Converts an unknown header value to a safe string.
   *
   * @param value Unknown header value.
   * @returns A normalized string when supported.
   */
  private static normalizeHeaderValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (Array.isArray(value)) {
      const stringValues = value.filter(
        (item): item is string => typeof item === 'string',
      );

      return stringValues.length > 0 ? stringValues.join(', ') : undefined;
    }

    return undefined;
  }

  /**
   * Reads the Retry-After header from an Axios error.
   *
   * Invalid or missing values are converted to zero.
   *
   * @param error Axios request error.
   * @returns Retry delay in seconds.
   */
  private static getRetryAfterSeconds(
    error: AxiosError<unknown> | undefined,
  ): number {
    const retryAfterHeader = this.getHeaderValue(
      error?.response?.headers,
      'retry-after',
    );

    if (!retryAfterHeader) {
      return 0;
    }

    const retryAfter = Number(retryAfterHeader);

    return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0;
  }

  /**
   * Converts response headers into the shared collector
   * response header structure.
   *
   * @param headers Axios response headers.
   * @returns A plain record containing response headers.
   */
  private static normalizeHeaders(headers: unknown): Record<string, unknown> {
    if (typeof headers !== 'object' || headers === null) {
      return {};
    }

    return {
      ...headers,
    };
  }

  /**
   * Converts an unknown error into a safe log message.
   *
   * Axios response data is serialized when possible.
   *
   * @param error Unknown caught error.
   * @returns A readable error message.
   */
  private static getErrorMessage(error: unknown): string {
    const axiosError = this.getAxiosError(error);

    if (axiosError) {
      const responseData: unknown = axiosError.response?.data;

      if (responseData !== undefined) {
        return this.stringifySafely(responseData);
      }

      return axiosError.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return this.stringifySafely(error);
  }

  /**
   * Converts an unknown value into a safe string.
   *
   * Objects are serialized as JSON instead of using the
   * default "[object Object]" representation.
   *
   * @param value Value to stringify.
   * @returns Safe textual representation.
   */
  private static stringifySafely(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    if (value === null || value === undefined) {
      return String(value);
    }

    try {
      const serialized = JSON.stringify(value);

      return serialized ?? 'Unknown value';
    } catch {
      return 'Unknown error';
    }
  }

  /**
   * Calculates retry delay.
   *
   * If Retry-After exists, it is respected.
   * Otherwise, exponential backoff is used.
   *
   * @param baseDelayMs Initial retry delay.
   * @param attempt Current request attempt.
   * @param retryAfterSeconds Retry-After value in seconds.
   * @returns Delay in milliseconds.
   */
  private static calculateBackoffDelay(
    baseDelayMs: number,
    attempt: number,
    retryAfterSeconds: number,
  ): number {
    if (retryAfterSeconds > 0) {
      return retryAfterSeconds * 1_000;
    }

    return baseDelayMs * Math.pow(2, attempt - 1);
  }

  /**
   * Pauses execution for the given number of milliseconds.
   *
   * @param ms Delay in milliseconds.
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
