import { Injectable, NotFoundException } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { IntelligentTextInput } from './types/intelligent-analysis.types';

/**
 * Represents the input context prepared for intelligent NLP analysis.
 *
 * @author Eman
 */
export type TextInputContext = {
  /**
   * Collection job identifier.
   */
  collectionJobId: string;

  /**
   * Language preference selected for the collection job.
   */
  language: LanguageCode;

  /**
   * Selected software domain and language-relevant keywords.
   */
  domain: {
    id: string;
    name: string;
    keywords: string[];
  };

  /**
   * Selected geographical context.
   */
  location: {
    country?: string | null;
    city?: string | null;
    region?: string | null;
  };

  /**
   * Stable data-source registry keys used by the collection job.
   */
  platforms: string[];

  /**
   * Unified post and comment inputs.
   */
  inputs: IntelligentTextInput[];
};

/**
 * Builds unified NLP text inputs from a collection job.
 *
 * This service loads the selected CollectionJob with its domain, configured
 * data sources, posts, and comments, then converts collected content into one
 * normalized NLP input contract.
 *
 * Responsibilities:
 * - Load CollectionJob data.
 * - Include domain and location context.
 * - Select domain keywords compatible with the requested language.
 * - Convert SocialPost records into NLP text inputs.
 * - Convert SocialComment records into NLP text inputs.
 * - Normalize collector-provided language identifiers.
 * - Preserve engagement and parent-post metadata.
 *
 * This service does not:
 * - Clean text.
 * - Detect missing languages.
 * - Analyze sentiment.
 * - Extract keywords or topics.
 * - Persist NLP results.
 *
 * @author Eman
 */
@Injectable()
export class TextInputBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads a collection job and converts its posts and comments into unified
   * IntelligentTextInput objects.
   *
   * @param collectionJobId Collection job identifier.
   * @returns Collection-job context and unified NLP text inputs.
   */
  async build(collectionJobId: string): Promise<TextInputContext> {
    const collectionJob = await this.prisma.collectionJob.findUnique({
      where: {
        id: collectionJobId,
      },
      select: {
        id: true,
        language: true,
        country: true,
        city: true,
        region: true,

        domain: {
          select: {
            id: true,
            name: true,
            domainKeywords: {
              select: {
                keyword: true,
                language: true,
              },
            },
          },
        },

        sources: {
          select: {
            dataSource: {
              select: {
                key: true,
              },
            },
          },
        },

        posts: {
          select: {
            id: true,
            title: true,
            content: true,
            languageCode: true,
            likesCount: true,
            repliesCount: true,

            comments: {
              select: {
                id: true,
                content: true,
                languageCode: true,
                likesCount: true,
              },
            },
          },
        },
      },
    });

    if (!collectionJob) {
      throw new NotFoundException('Collection job not found.');
    }

    const postInputs: IntelligentTextInput[] = collectionJob.posts.map(
      (post) => ({
        id: post.id,
        sourceType: 'POST',
        title: post.title,
        content: this.mergePostTitleAndContent(post.title, post.content),
        language: this.parseLanguageCode(post.languageCode),
        likesCount: post.likesCount,
        repliesCount: post.repliesCount,
      }),
    );

    const commentInputs: IntelligentTextInput[] = collectionJob.posts.flatMap(
      (post) =>
        post.comments.map((comment) => ({
          id: comment.id,
          sourceType: 'COMMENT' as const,
          postId: post.id,
          content: comment.content,
          language: this.parseLanguageCode(comment.languageCode),
          likesCount: comment.likesCount,
        })),
    );

    return {
      collectionJobId: collectionJob.id,
      language: collectionJob.language,

      domain: {
        id: collectionJob.domain.id,
        name: collectionJob.domain.name,
        keywords: this.selectDomainKeywords(
          collectionJob.domain.domainKeywords,
          collectionJob.language,
        ),
      },

      location: {
        country: collectionJob.country,
        city: collectionJob.city,
        region: collectionJob.region,
      },

      platforms: [
        ...new Set(
          collectionJob.sources.map((source) => source.dataSource.key),
        ),
      ],

      inputs: [...postInputs, ...commentInputs],
    };
  }

  /**
   * Selects global and language-specific domain keywords.
   *
   * When the collection language is ANY, all configured keywords are kept
   * because individual text languages are resolved during preprocessing.
   *
   * @param keywords Domain keyword records.
   * @param collectionLanguage Selected collection language.
   * @returns Unique normalized domain keywords.
   */
  private selectDomainKeywords(
    keywords: ReadonlyArray<{
      keyword: string;
      language: LanguageCode;
    }>,
    collectionLanguage: LanguageCode,
  ): string[] {
    const selectedKeywords = keywords
      .filter(
        (entry) =>
          collectionLanguage === LanguageCode.ANY ||
          entry.language === LanguageCode.ANY ||
          entry.language === collectionLanguage,
      )
      .map((entry) => entry.keyword.trim())
      .filter((keyword) => keyword.length > 0);

    return [...new Set(selectedKeywords)];
  }

  /**
   * Converts a raw collector-provided language identifier into a supported
   * Prisma LanguageCode.
   *
   * Unsupported or missing values return null so the preprocessing service
   * can run language detection.
   *
   * @param value Raw language identifier.
   * @returns Supported language code or null.
   */
  private parseLanguageCode(
    value: string | null | undefined,
  ): LanguageCode | null {
    if (!value) {
      return null;
    }

    const normalizedValue = value.trim().toLowerCase().replace('_', '-');

    const primaryLanguage = normalizedValue.split('-')[0];

    const languageMap: Readonly<Record<string, LanguageCode>> = {
      ar: LanguageCode.AR,
      arabic: LanguageCode.AR,

      en: LanguageCode.EN,
      english: LanguageCode.EN,

      fr: LanguageCode.FR,
      french: LanguageCode.FR,

      es: LanguageCode.ES,
      spanish: LanguageCode.ES,

      de: LanguageCode.DE,
      german: LanguageCode.DE,

      tr: LanguageCode.TR,
      turkish: LanguageCode.TR,
    };

    return languageMap[normalizedValue] ?? languageMap[primaryLanguage] ?? null;
  }

  /**
   * Merges a post title and body to provide richer NLP context.
   *
   * @param title Optional post title.
   * @param content Post body.
   * @returns Combined and trimmed post text.
   */
  private mergePostTitleAndContent(
    title: string | null,
    content: string,
  ): string {
    return [title?.trim(), content.trim()]
      .filter((value): value is string => Boolean(value))
      .join(' ');
  }
}
