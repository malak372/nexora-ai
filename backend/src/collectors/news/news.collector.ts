import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';

import { CollectorInput, CollectorPost } from '../base/collector.types';

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';

type NewsApiSource = {
  id?: string | null;
  name?: string;
};

type NewsApiArticle = {
  source?: NewsApiSource;
  author?: string | null;
  title?: string;
  description?: string | null;
  url?: string;
  urlToImage?: string | null;
  publishedAt?: string;
  content?: string | null;
};

type NewsApiResponse = {
  status?: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
};

type GoogleNewsRssItem = {
  guid?: string;
  link?: string;
  title?: string;
  content?: string;
  contentSnippet?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
};

/**
 * News collector.
 *
 * Collects public news articles using NewsAPI.
 *
 * @author Malak
 */
@Injectable()
export class NewsCollector extends BaseCollector implements SocialCollector {
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'news';

  private readonly apiBaseUrl = 'https://newsapi.org/v2';
  private static unavailableUntil = 0;
  private static readonly RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;
  private readonly rssParser = new Parser();

  constructor(configService: ConfigService) {
    super(configService, NewsCollector.name);
  }

  /**
   * Collects and ranks public news articles.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQueries = this.buildSearchQueries(input);

      if (!searchQueries.length) {
        this.logger.warn(
          'News collection skipped because no search keywords exist.',
        );

        return [];
      }

      const apiKey = this.getApiKey();
      const useRssFallback =
        input.collectionMode === 'FAST_GENERATION' ||
        input.collectionMode === 'TARGETED_RECOVERY' ||
        !apiKey ||
        NewsCollector.unavailableUntil > Date.now();

      if (useRssFallback) {
        this.logger.debug(
          'Using the bounded no-auth Google News RSS path for fast evidence collection.',
        );
        return this.collectFromGoogleNewsRss(searchQueries, input);
      }

      const queryResults = await Promise.allSettled(
        searchQueries.map((searchQuery) =>
          this.searchArticles(searchQuery, input),
        ),
      );
      const collectedArticles = queryResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );

      if (collectedArticles.length === 0) {
        return this.collectFromGoogleNewsRss(searchQueries, input);
      }

      const seenArticleUrls = new Set<string>();

      const rankedArticles = collectedArticles
        .filter((article) => this.isUsableArticle(article))
        .filter((article) => {
          const url = article.url;

          if (!url || seenArticleUrls.has(url)) {
            return false;
          }

          seenArticleUrls.add(url);

          return true;
        })
        .map((article) => ({
          article,
          score: this.calculateArticleRelevanceScore(article, input),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts)
        .map((item) => this.mapArticleToCollectorPost(item.article, input));

      this.logger.log(
        `News collection completed. Posts: ${rankedArticles.length}`,
      );

      return rankedArticles;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        NewsCollector.unavailableUntil =
          Date.now() + NewsCollector.RATE_LIMIT_COOLDOWN_MS;
        this.logger.warn(
          'NewsAPI rate limit reached; bounded generation news requests are disabled for 30 minutes.',
        );

        /*
         * News is an optional evidence source. A provider quota must never mark
         * the complete fast collection as failed or trigger recovery work.
         */
        if (
          input.collectionMode === 'FAST_GENERATION' ||
          input.collectionMode === 'TARGETED_RECOVERY'
        ) {
          return this.collectFromGoogleNewsRss(
            this.buildSearchQueries(input),
            input,
          );
        }
      }
      this.logger.error('News collection failed', this.getErrorMessage(error));

      if (
        input.collectionMode === 'FAST_GENERATION' ||
        input.collectionMode === 'TARGETED_RECOVERY'
      ) {
        return this.collectFromGoogleNewsRss(
          this.buildSearchQueries(input),
          input,
        );
      }

      throw new ServiceUnavailableException(
        'News collection failed. Check NEWS_API_KEY, API limits, collector limits, or network connection.',
      );
    }
  }

  private async collectFromGoogleNewsRss(
    searchQueries: readonly string[],
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const rankArticles = (articles: NewsApiArticle[]): CollectorPost[] => {
      const seen = new Set<string>();
      return articles
        .filter((article) => this.isUsableArticle(article))
        .filter((article) => {
          const key = article.url ?? article.title ?? '';
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((article) => ({
          article,
          score: this.calculateArticleRelevanceScore(article, input),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxSavedPosts)
        .map((entry) => this.mapArticleToCollectorPost(entry.article, input));
    };

    const queries = searchQueries.slice(0, 3);
    const results = await Promise.allSettled(
      queries.map((query) => this.searchGoogleNewsRss(query, input)),
    );
    const articles = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    const ranked = rankArticles(articles);
    if (ranked.length >= 2 || !input.requestDescription?.trim()) {
      return ranked;
    }

    const attempted = new Set(queries.map((query) => this.cleanNormalizedText(query)));
    const fallbackQueries = ProblemFirstCollectorQueryUtil.buildProgressiveFallback({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
    })
      .filter((query) => !attempted.has(this.cleanNormalizedText(query)))
      .slice(0, 2);

    if (fallbackQueries.length === 0) return ranked;

    const fallbackResults = await Promise.allSettled(
      fallbackQueries.map((query) => this.searchGoogleNewsRss(query, input)),
    );
    const fallbackArticles = fallbackResults.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    return rankArticles([...articles, ...fallbackArticles]);
  }

  private async searchGoogleNewsRss(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<NewsApiArticle[]> {
    const query = searchQuery
      .replace(/\s+(?:OR|AND|NOT)\s+/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 10)
      .join(' ');
    if (!query) return [];

    const arabic = CollectorLanguageUtil.isArabic(input.language);
    const locale = arabic
      ? { hl: 'ar', gl: 'PS', ceid: 'PS:ar' }
      : { hl: 'en-US', gl: 'US', ceid: 'US:en' };
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
    const response = await axios.get<string>(url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': 'NexoraAI-Graduation-Project',
      },
      responseType: 'text',
      timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 3_000 : 4_000,
    });
    const feed = await this.rssParser.parseString(response.data);

    return (feed.items ?? []).slice(0, this.maxFetchedPosts).map((raw) => {
      const item = raw as GoogleNewsRssItem;
      return {
        source: { name: this.cleanPlainText(item.creator ?? feed.title) },
        author: this.cleanPlainText(item.creator ?? feed.title),
        title: this.cleanPlainText(item.title),
        description: this.cleanPlainText(item.contentSnippet ?? item.content),
        content: this.cleanPlainText(item.content ?? item.contentSnippet),
        url: item.link,
        publishedAt: item.isoDate ?? item.pubDate,
      };
    });
  }

  /**
   * Searches NewsAPI using one query.
   */
  private async searchArticles(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<NewsApiArticle[]> {
    const boundedSearchQuery = this.boundNewsApiQuery(searchQuery);
    if (!boundedSearchQuery) {
      return [];
    }

    const cacheKey = CollectorCacheUtil.build(this.sourceKey, 'articles', [
      boundedSearchQuery,
      input.country,
      input.language,
    ]);

    const data = await CollectorHttpUtil.getWithRetryAndCache<NewsApiResponse>(
      `${this.apiBaseUrl}/everything`,
      {
        headers: this.buildHeaders(),

        params: {
          q: boundedSearchQuery,

          language: CollectorLanguageUtil.resolveNewsApiLanguage(
            input.language,
          ),

          sortBy: 'relevancy',

          pageSize: Math.min(this.maxFetchedPosts, 100),
        },

        timeout: 10_000,
      },
      {
        cacheKey,
        cacheTtlMs: this.cacheTtlMs,
        retryAttempts:
          input.collectionMode === 'FAST_GENERATION'
            ? 1
            : this.retryAttempts,
        retryDelayMs: this.retryDelayMs,
        retryOnRateLimit: input.collectionMode !== 'FAST_GENERATION',
      },
    );

    return data.articles ?? [];
  }

  /**
   * Builds search queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    if (input.requestDescription?.trim()) {
      const sourceAwareQueries = ProblemFirstCollectorQueryUtil.build({
        sourceKey: this.sourceKey,
        domainName: input.domainName,
        requestDescription: input.requestDescription,
        plannedQueries: input.plannedQueries,
        keywords: input.keywords,
      });
      const maximumTextQueries =
        input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3;
      return this.unique(sourceAwareQueries)
        .map((query) => this.boundNewsApiQuery(query))
        .filter(Boolean)
        .slice(0, maximumTextQueries);
    }

    const plannedQueries = (input.plannedQueries ?? [])
      .map((query) => this.cleanNormalizedText(query))
      .map((query) => this.boundNewsApiTerm(query))
      .filter(Boolean);

    if (plannedQueries.length > 0) {
      const maximumPlannedQueries =
        input.collectionMode === 'TARGETED_RECOVERY'
          ? 2
          : input.collectionMode === 'FAST_GENERATION'
            ? 3
            : 6;
      return this.unique(plannedQueries)
        .map((query) => this.boundNewsApiQuery(query))
        .filter(Boolean)
        .slice(0, maximumPlannedQueries);
    }

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .map((keyword) => this.boundNewsApiTerm(keyword))
      .filter(Boolean);

    const domainKeywords = this.getDomainKeywords(input)
      .map((keyword) => this.cleanNormalizedText(keyword))
      .map((keyword) => this.boundNewsApiTerm(keyword))
      .filter(Boolean);

    const fallbackDomain = input.domainName
      ? [this.boundNewsApiTerm(this.cleanNormalizedText(input.domainName))]
      : [];

    const baseTerms = this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ]).slice(0, 6);

    if (!baseTerms.length) {
      return [];
    }

    const problemTerms = this.getProblemWords()
      .map((word) => this.cleanNormalizedText(word))
      .filter(Boolean)
      .slice(0, 4);

    const queries = [
      baseTerms.join(' OR '),

      ...baseTerms.slice(0, 3),

      ...baseTerms
        .slice(0, 3)
        .flatMap((term) => problemTerms.map((problem) => `${term} ${problem}`)),
    ];

    const maximumQueries =
      input.collectionMode === 'FAST_GENERATION' ? 3 : 8;

    return this.unique(queries)
      .map((query) => this.boundNewsApiQuery(query))
      .filter(Boolean)
      .slice(0, maximumQueries);
  }

  private boundNewsApiTerm(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= 90) return normalized;

    return normalized
      .split(/\s+/u)
      .reduce<string[]>((parts, word) => {
        const candidate = [...parts, word].join(' ');
        return candidate.length <= 90 ? [...parts, word] : parts;
      }, [])
      .join(' ')
      .trim();
  }

  private boundNewsApiQuery(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= 450) return normalized;

    const parts = normalized.split(/\s+/u);
    const bounded: string[] = [];
    for (const part of parts) {
      const candidate = [...bounded, part].join(' ');
      if (candidate.length > 450) break;
      bounded.push(part);
    }

    return bounded
      .join(' ')
      .replace(/\s+(?:OR|AND|NOT)\s*$/iu, '')
      .trim();
  }

  /**
   * Validates a NewsAPI article.
   */
  private isUsableArticle(article: NewsApiArticle): boolean {
    const title = this.cleanPlainText(article.title);
    const description = this.cleanPlainText(article.description);

    if (!title || !article.url) {
      return false;
    }

    if (title === '[Removed]' || description === '[Removed]') {
      return false;
    }

    const text = this.cleanNormalizedText(
      `${title} ${description} ${article.content ?? ''}`,
    );

    const blockedWords = this.getBlockedWords();

    return !blockedWords.some((word) =>
      text.includes(this.cleanNormalizedText(word)),
    );
  }

  /**
   * Calculates article relevance.
   */
  private calculateArticleRelevanceScore(
    article: NewsApiArticle,
    input: CollectorInput,
  ): number {
    const baseScore = RelevanceScoreUtil.scoreText({
      title: this.cleanPlainText(article.title),

      body: this.cleanPlainText(
        `${article.description ?? ''} ${article.content ?? ''}`,
      ),

      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),

      likes: 0,
      replies: 0,

      publishedAt: this.parseDate(article.publishedAt),
    });

    return (
      baseScore +
      this.calculateKeywordBonus(article, input) +
      this.getArabicContextScore(article, input)
    );
  }

  /**
   * Adds score for user-keyword matches.
   */
  private calculateKeywordBonus(
    article: NewsApiArticle,
    input: CollectorInput,
  ): number {
    const keywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const title = this.cleanNormalizedText(article.title);

    const body = this.cleanNormalizedText(
      `${article.description ?? ''} ${article.content ?? ''}`,
    );

    let bonus = 0;

    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        bonus += 25;
      }

      if (body.includes(keyword)) {
        bonus += 10;
      }
    }

    return bonus;
  }

  /**
   * Adds lightweight Arabic context weighting.
   */
  private getArabicContextScore(
    article: NewsApiArticle,
    input: CollectorInput,
  ): number {
    if (!CollectorLanguageUtil.isArabic(input.language)) {
      return 0;
    }

    const text = this.cleanNormalizedText(`
      ${article.title ?? ''}
      ${article.description ?? ''}
      ${article.content ?? ''}
    `);

    const relevantTerms = [
      'تعليم',
      'التعليم',
      'تعليمي',
      'تعليمية',
      'تعلم',
      'دراسة',
      'دراسية',
      'جامعة',
      'جامعات',
      'طالب',
      'طلاب',
      'طالبة',
      'طالبات',
      'مدرسة',
      'مدارس',
      'معلم',
      'معلمين',
      'معلمة',
      'منهج',
      'مناهج',
      'صف',
      'صفوف',
      'امتحان',
      'اختبار',
      'اختبارات',
      'تربية',
      'تدريس',
      'منصة تعليمية',
      'تعليم إلكتروني',
      'تعليم عن بعد',
    ];

    const unrelatedTerms = [
      'كرة',
      'مباراة',
      'منتخب',
      'كأس العالم',
      'رياضة',
      'رياضي',
      'حرب',
      'هجوم',
      'ضربة',
      'قصف',
      'عسكري',
      'سياسي',
      'سياسية',
      'يمين متطرف',
      'مهاجرين',
      'شرطة',
      'اعتقال',
    ];

    let score = 0;

    for (const term of relevantTerms) {
      if (text.includes(term)) {
        score += 6;
      }
    }

    for (const term of unrelatedTerms) {
      if (text.includes(term)) {
        score -= 5;
      }
    }

    return score;
  }

  /**
   * Maps one NewsAPI article.
   */
  private mapArticleToCollectorPost(
    article: NewsApiArticle,
    input: CollectorInput,
  ): CollectorPost {
    return {
      externalId: this.buildExternalId(article),

      title: this.cleanPlainText(article.title),

      content: this.buildArticleContent(article),

      author: this.cleanPlainText(article.author ?? article.source?.name),

      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(input.language),

      likesCount: 0,
      repliesCount: 0,

      publishedAt: this.parseDate(article.publishedAt),

      comments: [],
    };
  }

  /**
   * Builds clean article content.
   */
  private buildArticleContent(article: NewsApiArticle): string {
    return this.cleanPlainText(
      [article.description, article.content, article.title]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  /**
   * Builds a stable article external ID.
   */
  private buildExternalId(article: NewsApiArticle): string {
    const identity =
      article.url ?? `${article.title ?? ''}-${article.publishedAt ?? ''}`;

    return Buffer.from(identity).toString('base64url').slice(0, 100);
  }

  /**
   * Reads NEWS_API_KEY.
   */
  private getApiKey(): string {
    return this.configService.get<string>('NEWS_API_KEY') ?? '';
  }

  /**
   * Reads News-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('NEWS_BLOCKED_WORDS');
  }

  /**
   * Builds NewsAPI headers.
   */
  private buildHeaders(): Record<string, string> {
    return {
      ...CollectorHeaderUtil.json(),
      'X-Api-Key': this.getApiKey(),
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }

  /**
   * Parses an external date safely.
   */
  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown News collector error.';
  }
}