import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../base/base.collector';
import { SocialCollector } from '../base/collector.interface';
import {
  CollectorInput,
  CollectorPost,
  CollectorComment,
} from '../base/collector.types';

import { CollectorHttpUtil } from '../base/collector-http.util';
import { CollectorCacheUtil } from '../base/collector-cache.util';
import { CollectorHeaderUtil } from '../base/collector-header.util';
import { RelevanceScoreUtil } from '../base/relevance-score.util';

/**
 * News collector.
 *
 * Collects public news articles using NewsAPI.
 *
 * This collector is intentionally permissive:
 * - It does not reject articles just because description/content is missing.
 * - It does not reject short articles.
 * - It only removes clearly unusable records such as missing URL/title
 *   or removed NewsAPI records.
 *
 * Relevance is handled by scoring and ranking instead of strict rejection.
 *
 * @author Malak
 */
@Injectable()
export class NewsCollector extends BaseCollector implements SocialCollector {
  readonly sourceType = CollectionSourceType.NEWS;

  private readonly platformName = 'News';
  private readonly apiBaseUrl = 'https://newsapi.org/v2';

  constructor(configService: ConfigService) {
    super(configService, NewsCollector.name);
  }

  /**
   * Collects public news articles and returns normalized posts.
   *
   * @param input Collection request context.
   * @returns Ranked and normalized news posts.
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

      const collectedArticles: any[] = [];

      for (const searchQuery of searchQueries) {
        if (collectedArticles.length >= this.maxFetchedPosts) break;

        const articles = await this.searchArticles(searchQuery, input);
        collectedArticles.push(...articles);
      }

      const seenArticleUrls = new Set<string>();

      const rankedArticles = collectedArticles
        .filter((article: any) => this.isUsableArticle(article))
        .filter((article: any) => {
          const url = article?.url;

          if (!url || seenArticleUrls.has(url)) return false;

          seenArticleUrls.add(url);
          return true;
        })
        .map((article: any) => ({
          article,
          score: this.calculateArticleRelevanceScore(article, input),
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, this.maxSavedPosts)
        .map((item: any) => this.mapArticleToCollectorPost(item.article, input));

      this.logger.log(`News collection completed. Posts: ${rankedArticles.length}`);

      return rankedArticles;
    } catch (error: any) {
      this.logger.error(
        'News collection failed',
        error.response?.data ?? error.message,
      );

      throw new ServiceUnavailableException(
        'News collection failed. Check NEWS_API_KEY, API limits, collector limits, or network connection.',
      );
    }
  }

  /**
   * Searches NewsAPI using one prepared query.
   *
   * @param searchQuery NewsAPI query.
   * @param input Collection request context.
   * @returns Raw NewsAPI articles.
   */
  private async searchArticles(
    searchQuery: string,
    input: CollectorInput,
  ): Promise<any[]> {
    const cacheKey = CollectorCacheUtil.build('news', 'articles', [
      searchQuery,
      input.country,
      input.language,
    ]);

    const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
      `${this.apiBaseUrl}/everything`,
      {
        headers: this.buildHeaders(),
        params: {
          q: searchQuery,
          language: this.resolveLanguageCode(input.language),
          sortBy: 'relevancy',
          pageSize: Math.min(this.maxFetchedPosts, 100),
        },
        timeout: 10000,
      },
      {
        cacheKey,
        cacheTtlMs: this.cacheTtlMs,
        retryAttempts: this.retryAttempts,
        retryDelayMs: this.retryDelayMs,
      },
    );

    return data?.articles ?? [];
  }

  /**
   * Builds multiple search queries to improve search coverage.
   *
   * @param input Collection request context.
   * @returns List of NewsAPI search queries.
   */
  private buildSearchQueries(input: CollectorInput): string[] {
    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const domainKeywords = this.getDomainKeywords(input)
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    const fallbackDomain = input.domainName
      ? [this.normalizeText(input.domainName)]
      : [];

    const baseTerms = this.unique([
      ...userKeywords,
      ...domainKeywords,
      ...fallbackDomain,
    ]).slice(0, 6);

    if (!baseTerms.length) return [];

    const problemTerms = this.getProblemWords()
      .map((word) => this.normalizeText(word))
      .filter(Boolean)
      .slice(0, 4);

    const queries = [
      baseTerms.join(' OR '),
      ...baseTerms.slice(0, 3),
      ...baseTerms.slice(0, 3).flatMap((term) =>
        problemTerms.map((problem) => `${term} ${problem}`),
      ),
    ];

    return this.unique(queries).slice(0, 8);
  }

  /**
   * Keeps only articles that are safe enough to store.
   *
   * This method is intentionally light and does not reject
   * articles because they are short or missing description/content.
   *
   * @param article Raw NewsAPI article.
   * @returns True if the article can be stored.
   */
  private isUsableArticle(article: any): boolean {
    const title = article?.title ?? '';
    const url = article?.url ?? '';
    const description = article?.description ?? '';

    if (!title || !url) return false;

    if (title === '[Removed]' || description === '[Removed]') return false;

    const blockedWords = this.getBlockedWords();
    const text = this.normalizeText(
      `${title} ${description} ${article?.content ?? ''}`,
    );

    return !blockedWords.some((word) => text.includes(word));
  }

  /**
   * Calculates the final relevance score for a news article.
   *
   * The score combines:
   * - Generic relevance score.
   * - User keyword bonus.
   * - Arabic context score.
   *
   * @param article Raw NewsAPI article.
   * @param input Collection request context.
   * @returns Final relevance score.
   */
  private calculateArticleRelevanceScore(
    article: any,
    input: CollectorInput,
  ): number {
    const baseScore = RelevanceScoreUtil.scoreText({
      title: article?.title ?? '',
      body: `${article?.description ?? ''} ${article?.content ?? ''}`,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: 0,
      replies: 0,
      publishedAt: article?.publishedAt
        ? new Date(article.publishedAt)
        : undefined,
    });

    return (
      baseScore +
      this.calculateKeywordBonus(article, input) +
      this.getArabicContextScore(article, input)
    );
  }

  /**
   * Gives extra score when user keywords appear in title or body.
   *
   * @param article Raw NewsAPI article.
   * @param input Collection request context.
   * @returns Keyword bonus score.
   */
  private calculateKeywordBonus(article: any, input: CollectorInput): number {
    const keywords = (input.keywords ?? [])
      .map((keyword) => this.normalizeText(keyword))
      .filter(Boolean);

    if (!keywords.length) return 0;

    const title = this.normalizeText(article?.title ?? '');
    const body = this.normalizeText(
      `${article?.description ?? ''} ${article?.content ?? ''}`,
    );

    let bonus = 0;

    for (const keyword of keywords) {
      if (title.includes(keyword)) bonus += 25;
      if (body.includes(keyword)) bonus += 10;
    }

    return bonus;
  }

  /**
   * Improves Arabic news ranking using simple contextual weighting.
   *
   * This does not reject articles.
   * It only pushes more education-related Arabic news upward
   * and pushes unrelated political/sports/war context downward.
   *
   * @param article Raw NewsAPI article.
   * @param input Collection request context.
   * @returns Arabic context score.
   */
  private getArabicContextScore(article: any, input: CollectorInput): number {
    const language = this.normalizeText(input.language ?? '');

    if (language !== 'ar' && language !== 'arabic' && language !== 'ara') {
      return 0;
    }

    const text = this.normalizeText(`
      ${article?.title ?? ''}
      ${article?.description ?? ''}
      ${article?.content ?? ''}
    `);

    const educationTerms = [
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

    for (const word of educationTerms) {
      if (text.includes(word)) score += 6;
    }

    for (const word of unrelatedTerms) {
      if (text.includes(word)) score -= 5;
    }

    return score;
  }

  /**
   * Maps a NewsAPI article into CollectorPost format.
   *
   * @param article Raw NewsAPI article.
   * @param input Collection request context.
   * @returns Normalized CollectorPost.
   */
  private mapArticleToCollectorPost(
    article: any,
    input: CollectorInput,
  ): CollectorPost {
    return {
      sourceType: CollectionSourceType.NEWS,
      platformName: this.platformName,
      externalId: this.buildExternalId(article),
      title: article.title,
      content: this.buildArticleContent(article),
      author: article.author ?? article.source?.name,
      url: article.url,

      country: input.country,
      city: input.city,
      region: input.region,

      language: input.language,
      likesCount: 0,
      repliesCount: 0,
      publishedAt: article.publishedAt
        ? new Date(article.publishedAt)
        : undefined,
      comments: this.collectArticleComments(),
    };
  }

  /**
   * NewsAPI does not provide article comments.
   *
   * @returns Empty comments array.
   */
  private collectArticleComments(): CollectorComment[] {
    return [];
  }

  /**
   * Builds article content safely.
   *
   * @param article Raw NewsAPI article.
   * @returns Clean article content.
   */
  private buildArticleContent(article: any): string {
    const content = [article.description, article.content, article.title]
      .filter(Boolean)
      .join('\n\n');

    return this.stripHtml(content);
  }

  /**
   * Builds stable external ID for article.
   *
   * @param article Raw NewsAPI article.
   * @returns External article ID.
   */
  private buildExternalId(article: any): string {
    return Buffer.from(article.url ?? article.title ?? Date.now().toString())
      .toString('base64')
      .slice(0, 64);
  }

  /**
   * Resolves requested language to NewsAPI language code.
   *
   * @param language User requested language.
   * @returns NewsAPI supported language code.
   */
  private resolveLanguageCode(language?: string | null): string | undefined {
    if (!language) return undefined;

    const normalized = this.normalizeText(language);

    const languageMap: Record<string, string> = {
      en: 'en',
      eng: 'en',
      english: 'en',
      ar: 'ar',
      ara: 'ar',
      arabic: 'ar',
      fr: 'fr',
      french: 'fr',
      de: 'de',
      german: 'de',
      es: 'es',
      spanish: 'es',
    };

    const supportedLanguages = new Set([
      'ar',
      'de',
      'en',
      'es',
      'fr',
      'he',
      'it',
      'nl',
      'no',
      'pt',
      'ru',
      'sv',
      'ud',
      'zh',
    ]);

    const code = languageMap[normalized] ?? normalized.slice(0, 2);

    return supportedLanguages.has(code) ? code : undefined;
  }

  /**
   * Reads NewsAPI key from environment variables.
   *
   * @returns NewsAPI key.
   */
  private getApiKey(): string {
    return this.configService.get<string>('NEWS_API_KEY') ?? '';
  }

  /**
   * Reads common and News-specific blocked words.
   *
   * @returns Blocked words list.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('NEWS_BLOCKED_WORDS');
  }

  /**
   * Builds NewsAPI request headers.
   *
   * @returns HTTP headers.
   */
  private buildHeaders(): Record<string, string> {
    return {
      ...CollectorHeaderUtil.json(),
      'X-Api-Key': this.getApiKey(),
      'User-Agent': 'NexoraAI/1.0.0 academic-project',
    };
  }
}