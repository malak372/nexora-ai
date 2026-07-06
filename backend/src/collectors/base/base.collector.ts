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
   */
  private getPositiveNumber(key: string, defaultValue: number): number {
    const value = Number(this.configService.get(key));

    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }

  /**
   * Extracts and normalizes domain keywords from collector input.
   */
  protected getDomainKeywords(input: CollectorInput): string[] {
    return (input.domainKeywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);
  }

  /**
   * Reads global problem words from environment variables.
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
   */
  protected normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Removes duplicated values while preserving order.
   */
  protected unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }

  /**
   * Decodes the most common HTML entities returned by APIs.
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
   */
  protected stripHtml(text = ''): string {
    return this.decodeHtml(text.replace(/<[^>]*>/g, ' '));
  }
}