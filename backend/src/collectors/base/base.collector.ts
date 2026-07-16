import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CollectorInput } from './collector.types';
import { CollectorConfigUtil } from './collector-config.util';

/**
 * Base abstract collector.
 *
 * Contains shared configuration and helper methods used by
 * platform-specific collectors.
 *
 * This class does not define source identity. Each concrete
 * collector exposes its own sourceKey through SocialCollector.
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

    this.retryAttempts = this.getPositiveNumber('COLLECTOR_RETRY_ATTEMPTS', 3);

    this.retryDelayMs = this.getPositiveNumber('COLLECTOR_RETRY_DELAY_MS', 800);

    this.cacheTtlMs = this.getPositiveNumber('COLLECTOR_CACHE_TTL_MS', 300_000);
  }

  /**
   * Reads a positive numeric configuration value.
   *
   * Missing, non-numeric, zero, and negative values fall back
   * to the supplied default.
   */
  protected getPositiveNumber(key: string, defaultValue: number): number {
    const value = Number(this.configService.get<unknown>(key));

    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }

  /**
   * Extracts normalized domain keywords.
   */
  protected getDomainKeywords(input: CollectorInput): string[] {
    return (input.domainKeywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);
  }

  /**
   * Reads global problem words from configuration.
   */
  protected getProblemWords(): string[] {
    return CollectorConfigUtil.getCsv(
      this.configService,
      'COLLECTOR_PROBLEM_WORDS',
    );
  }

  /**
   * Merges global and platform-specific blocked words.
   */
  protected getBlockedWords(platformBlockedWordsKey: string): string[] {
    return CollectorConfigUtil.getMergedCsv(
      this.configService,
      'COLLECTOR_BLOCKED_WORDS',
      platformBlockedWordsKey,
    );
  }

  /**
   * Normalizes text for searching and matching.
   */
  protected normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Removes duplicate values while preserving order.
   */
  protected unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }

  /**
   * Decodes common HTML entities.
   */
  protected decodeHtml(text: string): string {
    return text
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  /**
   * Removes HTML tags and decodes common entities.
   */
  protected stripHtml(text = ''): string {
    return this.decodeHtml(text.replace(/<[^>]*>/g, ' '));
  }

  /**
   * Converts external API content to safe plain text
   * while preserving letter casing.
   */
  protected cleanPlainText(text?: string | null): string {
    return this.stripHtml(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Converts external API content to normalized
   * lowercase plain text.
   */
  protected cleanNormalizedText(text?: string | null): string {
    return this.normalizeText(this.cleanPlainText(text));
  }

  /**
   * Converts a project LanguageCode into a value suitable
   * for the nullable string languageCode database field.
   *
   * ANY is not a real detected content language, so it is
   * stored as undefined.
   */
  protected resolveStoredLanguageCode(language?: string): string | undefined {
    if (!language || language.toUpperCase() === 'ANY') {
      return undefined;
    }

    return language.toLowerCase();
  }
}
