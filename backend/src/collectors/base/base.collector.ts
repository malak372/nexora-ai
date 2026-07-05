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

    this.maxFetchedPosts =
      Number(this.configService.get('COLLECTOR_MAX_FETCHED_POSTS')) || 50;

    this.maxSavedPosts =
      Number(this.configService.get('COLLECTOR_MAX_SAVED_POSTS')) || 30;

    this.maxFetchedComments =
      Number(this.configService.get('COLLECTOR_MAX_FETCHED_COMMENTS')) || 20;

    this.maxSavedComments =
      Number(this.configService.get('COLLECTOR_MAX_SAVED_COMMENTS')) || 30;

    this.retryAttempts =
      Number(this.configService.get('COLLECTOR_RETRY_ATTEMPTS')) || 3;

    this.retryDelayMs =
      Number(this.configService.get('COLLECTOR_RETRY_DELAY_MS')) || 800;

    this.cacheTtlMs =
      Number(this.configService.get('COLLECTOR_CACHE_TTL_MS')) || 300000;
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
   *
   * Example:
   * this.getBlockedWords('GITHUB_BLOCKED_WORDS')
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
  protected stripHtml(text: string): string {
    return this.decodeHtml(text.replace(/<[^>]*>/g, ' '));
  }
}