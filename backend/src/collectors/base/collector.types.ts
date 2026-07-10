import { CollectionSourceType, LanguageCode } from '@prisma/client';

/**
 * Input passed to all social platform collectors.
 *
 * @author Malak
 */
export type CollectorInput = {
  domainName: string;
  domainKeywords?: string[];

  country: string;
  language: LanguageCode;
  city?: string;
  region?: string;
  radiusKm?: number;

  keywords?: string[];
};

/**
 * Unified comment format returned by any collector.
 *
 * externalId is required because it is used with postId
 * to prevent duplicate comments.
 *
 * @author Malak
 */
export type CollectorComment = {
  externalId: string;
  content: string;
  author?: string;
  language?: LanguageCode;
  likesCount?: number;
  publishedAt?: Date;
};

/**
 * Unified post format returned by any collector.
 *
 * externalId is required because it is used with sourceType
 * to prevent duplicate posts.
 *
 * @author Malak
 */
export type CollectorPost = {
  sourceType: CollectionSourceType;
  platformName: string;
  externalId: string;
  title?: string;
  content: string;
  author?: string;
  url?: string;
  country?: string;
  city?: string;
  region?: string;
  language?: LanguageCode;
  likesCount?: number;
  repliesCount?: number;
  publishedAt?: Date;
  comments: CollectorComment[];
};
