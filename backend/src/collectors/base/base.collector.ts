import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ConfigService } from '@nestjs/config';

import { CollectorInput, CollectorLimits } from './collector.types';
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

  /**
   * Per-async-execution collector limits. Collectors are singleton Nest
   * providers and several sources can run concurrently, therefore mutable
   * instance fields would leak limits between runs. AsyncLocalStorage keeps
   * the active FAST_GENERATION limits isolated for each collector invocation.
   */
  private static readonly limitContext =
    new AsyncLocalStorage<CollectorLimits>();

  private readonly defaultMaxFetchedPosts: number;
  private readonly defaultMaxSavedPosts: number;

  private readonly defaultMaxFetchedComments: number;
  private readonly defaultMaxSavedComments: number;

  protected get maxFetchedPosts(): number {
    return this.resolveLimit(
      BaseCollector.limitContext.getStore()?.maxFetchedPosts,
      this.defaultMaxFetchedPosts,
    );
  }

  protected get maxSavedPosts(): number {
    return this.resolveLimit(
      BaseCollector.limitContext.getStore()?.maxSavedPosts,
      this.defaultMaxSavedPosts,
    );
  }

  protected get maxFetchedComments(): number {
    return this.resolveLimit(
      BaseCollector.limitContext.getStore()?.maxFetchedComments,
      this.defaultMaxFetchedComments,
    );
  }

  protected get maxSavedComments(): number {
    return this.resolveLimit(
      BaseCollector.limitContext.getStore()?.maxSavedComments,
      this.defaultMaxSavedComments,
    );
  }

  protected readonly retryAttempts: number;
  protected readonly retryDelayMs: number;
  protected readonly cacheTtlMs: number;

  protected constructor(
    protected readonly configService: ConfigService,
    collectorName: string,
  ) {
    this.logger = new Logger(collectorName);

    this.defaultMaxFetchedPosts = this.getPositiveNumber(
      'COLLECTOR_MAX_FETCHED_POSTS',
      80,
    );

    this.defaultMaxSavedPosts = this.getPositiveNumber(
      'COLLECTOR_MAX_SAVED_POSTS',
      40,
    );

    this.defaultMaxFetchedComments = this.getPositiveNumber(
      'COLLECTOR_MAX_FETCHED_COMMENTS',
      40,
    );

    this.defaultMaxSavedComments = this.getPositiveNumber(
      'COLLECTOR_MAX_SAVED_COMMENTS',
      40,
    );

    this.retryAttempts = this.getPositiveNumber('COLLECTOR_RETRY_ATTEMPTS', 3);

    this.retryDelayMs = this.getPositiveNumber('COLLECTOR_RETRY_DELAY_MS', 800);

    this.cacheTtlMs = this.getPositiveNumber('COLLECTOR_CACHE_TTL_MS', 300_000);
  }

  /**
   * Executes one collector call with isolated per-run limits.
   *
   * Existing collectors may read the inherited max* properties directly.
   * Wrapping the complete asynchronous operation here guarantees that all of
   * them honour CollectorInput.limits without rewriting every implementation.
   */
  runWithLimits<T>(
    input: CollectorInput,
    operation: () => Promise<T>,
  ): Promise<T> {
    return BaseCollector.limitContext.run(input.limits ?? {}, operation);
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

  /** Resolves a positive per-run override without mutating collector state. */
  protected resolveLimit(
    override: number | undefined,
    fallback: number,
  ): number {
    return Number.isFinite(override) && Number(override) > 0
      ? Math.floor(Number(override))
      : fallback;
  }

  protected resolveMaxFetchedPosts(input: CollectorInput): number {
    return this.resolveLimit(
      input.limits?.maxFetchedPosts,
      this.maxFetchedPosts,
    );
  }

  protected resolveMaxSavedPosts(input: CollectorInput): number {
    return this.resolveLimit(input.limits?.maxSavedPosts, this.maxSavedPosts);
  }

  protected resolveMaxFetchedComments(input: CollectorInput): number {
    return this.resolveLimit(
      input.limits?.maxFetchedComments,
      this.maxFetchedComments,
    );
  }

  protected resolveMaxSavedComments(input: CollectorInput): number {
    return this.resolveLimit(
      input.limits?.maxSavedComments,
      this.maxSavedComments,
    );
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