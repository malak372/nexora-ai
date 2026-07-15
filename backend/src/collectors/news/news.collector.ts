import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';

import {
  CollectorInput,
  CollectorPost,
} from '../base/collector.types';

import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorLanguageUtil } from '../base/collector-language.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

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

/**
 * News collector.
 *
 * Collects public news articles using NewsAPI.
 *
 * @author Malak
 */
@Injectable()
export class NewsCollector
  extends BaseCollector
  implements SocialCollector
{
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'news';

  private readonly apiBaseUrl =
    'https://newsapi.org/v2';

  constructor(configService: ConfigService) {
    super(configService, NewsCollector.name);
  }

  /**
   * Collects and ranks public news articles.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const apiKey = this.getApiKey();
      const searchQueries = this.buildSearchQueries(input);

      if (!apiKey) {
        this.logger.warn(
          'News collection skipped because NEWS_API_KEY is missing.',
        );

        return [];
      }

      if (!searchQueries.length) {
        this.logger.warn(
          'News collection skipped because no search keywords exist.',
        );

        return [];
      }

      const collectedArticles: NewsApiArticle[] = [];

      for (const searchQuery of searchQueries) {
        if (
          collectedArticles.length >=
          this.maxFetchedPosts
        ) {
          break;
        }

        const articles = await this.searchArticles(
          searchQuery,
          input,
        );

        collectedArticles.push(...articles);
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
          score: this.calculateArticleRelevanceScore(
            article,
            input,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score)
        .slice(0, this.maxSavedPosts)
        .map((item) =>
          this.mapArticleToCollectorPost(
            item.article,
            input,
          ),
        );

      this.logger.log(
        `News collection completed. Posts: ${rankedArticles.length}`,
      );

      return rankedArticles;
    } catch (error: unknown) {
      this.logger.error(
        'News collection failed',
        this.getErrorMessage(error),
      );

      throw new ServiceUnavailableException(
        'News collection failed. Check NEWS_API_KEY, API limits, collector limits, or network connection.',
      );
    }
  }

  /**
   * Searches NewsAPI using one query.
   */
  private async searchArticles(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<NewsApiArticle[]> {
    const cacheKey = CollectorCacheUtil.build(
      this.sourceKey,
      'articles',
      [
        searchQuery,
        input.country,
        input.language,
      ],
    );

    const data =
      await CollectorHttpUtil.getWithRetryAndCache<NewsApiResponse>(
        `${this.apiBaseUrl}/everything`,
        {
          headers: this.buildHeaders(),

          params: {
            q: searchQuery,

            language:
              CollectorLanguageUtil.resolveNewsApiLanguage(
                input.language,
              ),

            sortBy: 'relevancy',

            pageSize: Math.min(
              this.maxFetchedPosts,
              100,
            ),
          },

          timeout: 10_000,
        },
        {
          cacheKey,
          cacheTtlMs: this.cacheTtlMs,
          retryAttempts: this.retryAttempts,
          retryDelayMs: this.retryDelayMs,
        },
      );

    return data.articles ?? [];
  }

  /**
   * Builds search queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const domainKeywords = this.getDomainKeywords(input)
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
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
        .flatMap((term) =>
          problemTerms.map(
            (problem) => `${term} ${problem}`,
          ),
        ),
    ];

    return this.unique(queries).slice(0, 8);
  }

  /**
   * Validates a NewsAPI article.
   */
  private isUsableArticle(article: NewsApiArticle): boolean {
    const title = this.cleanPlainText(article.title);
    const description = this.cleanPlainText(
      article.description,
    );

    if (!title || !article.url) {
      return false;
    }

    if (
      title === '[Removed]' ||
      description === '[Removed]'
    ) {
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
        `${article.description ?? ''} ${
          article.content ?? ''
        }`,
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
      `${article.description ?? ''} ${
        article.content ?? ''
      }`,
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

      author: this.cleanPlainText(
        article.author ?? article.source?.name,
      ),

      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      languageCode: this.resolveStoredLanguageCode(
        input.language,
      ),

      likesCount: 0,
      repliesCount: 0,

      publishedAt: this.parseDate(article.publishedAt),

      comments: [],
    };
  }

  /**
   * Builds clean article content.
   */
  private buildArticleContent(
    article: NewsApiArticle,
  ): string {
    return this.cleanPlainText(
      [
        article.description,
        article.content,
        article.title,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  /**
   * Builds a stable article external ID.
   */
  private buildExternalId(
    article: NewsApiArticle,
  ): string {
    const identity =
      article.url ??
      `${article.title ?? ''}-${article.publishedAt ?? ''}`;

    return Buffer.from(identity)
      .toString('base64url')
      .slice(0, 100);
  }

  /**
   * Reads NEWS_API_KEY.
   */
  private getApiKey(): string {
    return (
      this.configService.get<string>('NEWS_API_KEY') ??
      ''
    );
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

    return typeof error === 'string'
      ? error
      : 'Unknown News collector error.';
  }
}