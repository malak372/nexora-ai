import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CollectorInput } from './collector.types';
import { CollectorConfigUtil } from './collector-config.util';

/**
 * Base abstract collector.
 *
 * Contains shared configuration and helper methods used by
 * platform-specific collectors such as GitHub, YouTube, Reddit,
 * Stack Overflow, and others.
 *
 * This class does not implement collection logic because every
 * platform has a different API structure, response format, and
 * filtering strategy.
 *
 * @author Malak
 */
export abstract class BaseCollector {
  protected readonly logger: Logger;

  protected readonly maxFetchedPosts: number;
  protected readonly maxSavedPosts: number;

  protected readonly maxFetchedComments: number;
  protected readonly maxSavedComments: number;

  protected readonly retryAttempts: number;
  protected readonly retryDelayMs: number;
  protected readonly cacheTtlMs: number;

  protected constructor(
    protected readonly configService: ConfigService,
    collectorName: string,
  ) {
    this.logger = new Logger(collectorName);

    this.maxFetchedPosts = this.getPositiveNumber(
      'COLLECTOR_MAX_FETCHED_POSTS',
      50,
    );

    this.maxSavedPosts = this.getPositiveNumber(
      'COLLECTOR_MAX_SAVED_POSTS',
      30,
    );

    this.maxFetchedComments = this.getPositiveNumber(
      'COLLECTOR_MAX_FETCHED_COMMENTS',
      20,
    );

    this.maxSavedComments = this.getPositiveNumber(
      'COLLECTOR_MAX_SAVED_COMMENTS',
      30,
    );

    this.retryAttempts = this.getPositiveNumber(
      'COLLECTOR_RETRY_ATTEMPTS',
      3,
    );

    this.retryDelayMs = this.getPositiveNumber(
      'COLLECTOR_RETRY_DELAY_MS',
      800,
    );

    this.cacheTtlMs = this.getPositiveNumber(
      'COLLECTOR_CACHE_TTL_MS',
      300000,
    );
  }

  /**
   * Reads a positive numeric configuration value.
   *
   * If the environment variable is missing, invalid, zero,
   * or negative, the default value is used.
   *
   * @param key Environment variable key.
   * @param defaultValue Fallback value when the key is invalid.
   * @returns A positive number from environment variables or the default value.
   */
  protected getPositiveNumber(key: string, defaultValue: number): number {
    const value = Number(this.configService.get(key));

    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }

  /**
   * Extracts and normalizes domain keywords from collector input.
   *
   * @param input Collector input containing optional domain keywords.
   * @returns Normalized non-empty domain keywords.
   */
  protected getDomainKeywords(input: CollectorInput): string[] {
    return (input.domainKeywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);
  }

  /**
   * Reads global problem words from environment variables.
   *
   * @returns List of configured problem words.
   */
  protected getProblemWords(): string[] {
    return CollectorConfigUtil.getCsv(
      this.configService,
      'COLLECTOR_PROBLEM_WORDS',
    );
  }

  /**
   * Reads global blocked words and merges them with platform-specific
   * blocked words.
   *
   * @param platformBlockedWordsKey Environment variable key for platform-specific blocked words.
   * @returns Merged list of global and platform-specific blocked words.
   */
  protected getBlockedWords(platformBlockedWordsKey: string): string[] {
    return CollectorConfigUtil.getMergedCsv(
      this.configService,
      'COLLECTOR_BLOCKED_WORDS',
      platformBlockedWordsKey,
    );
  }

  /**
   * Normalizes text for lightweight matching.
   *
   * This method lowercases the text, trims it, and collapses
   * repeated whitespace. Use it for keyword matching, filtering,
   * deduplication, and scoring logic.
   *
   * Do not use this method directly for user-facing stored content
   * if preserving original casing is important.
   *
   * @param text Raw text.
   * @returns Normalized lowercase text.
   */
  protected normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Removes duplicated values while preserving order.
   *
   * @param values Array that may contain duplicated values.
   * @returns Array with duplicates removed.
   */
  protected unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }

  /**
   * Decodes the most common HTML entities returned by APIs.
   *
   * @param text Text that may contain encoded HTML entities.
   * @returns Text with common HTML entities decoded.
   */
  protected decodeHtml(text: string): string {
    return text
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  /**
   * Removes HTML tags and decodes common HTML entities.
   *
   * @param text Raw text that may contain HTML tags.
   * @returns Plain text without HTML tags.
   */
  protected stripHtml(text = ''): string {
    return this.decodeHtml(text.replace(/<[^>]*>/g, ' '));
  }

  /**
   * Converts raw API text into safe plain text.
   *
   * Handles null/undefined values, removes HTML tags,
   * decodes common HTML entities, trims the result, and collapses
   * repeated whitespace.
   *
   * Use this method for stored or displayed content such as:
   * title, body, description, summary, review text, and comment text.
   *
   * This method preserves original letter casing.
   *
   * @param text Raw external API text.
   * @returns Clean plain text.
   */
  protected cleanPlainText(text?: string | null): string {
    return this.stripHtml(text ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Converts raw API text into normalized plain text.
   *
   * Handles null/undefined values, removes HTML tags,
   * decodes common HTML entities, trims the result, collapses
   * repeated whitespace, and lowercases the text.
   *
   * Use this method for matching, searching, scoring, filtering,
   * and duplicate detection.
   *
   * @param text Raw external API text.
   * @returns Clean normalized lowercase text.
   */
  protected cleanNormalizedText(text?: string | null): string {
    return this.normalizeText(this.cleanPlainText(text));
  }
}