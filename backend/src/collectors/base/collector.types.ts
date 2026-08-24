import { LanguageCode } from '@prisma/client';

/**
 * Input passed to every collector implementation.
 *
 * @author Malak
 */
export type CollectorCollectionMode =
  | 'STANDARD'
  | 'FAST_GENERATION'
  | 'TARGETED_RECOVERY';

export type CollectorLimits = {
  readonly maxFetchedPosts?: number;
  readonly maxSavedPosts?: number;
  readonly maxFetchedComments?: number;
  readonly maxSavedComments?: number;
};

export type CollectorInput = {
  /**
   * Selected software-domain name.
   */
  domainName: string;

  /**
   * Keywords configured for the selected domain.
   */
  domainKeywords?: string[];

  /**
   * Optional geographical collection context.
   *
   * Some external platforms do not support location filtering.
   * In that case, these values remain collection metadata.
   */
  country?: string;
  city?: string;
  region?: string;
  radiusKm?: number;

  /**
   * Requested project language.
   */
  language: LanguageCode;

  /**
   * Optional custom keywords supplied by the user.
   */
  keywords?: string[];

  /**
   * Original requester description for source-specific query shaping.
   * This is never treated as external evidence; it only guides retrieval.
   */
  requestDescription?: string;

  /**
   * AI-planned first-pass searches. These remain separate from generic domain
   * keywords so source-specific collectors can preserve requester intent
   * instead of re-expanding an already focused query into a broad search.
   */
  plannedQueries?: string[];

  /** AI source-specific routing hints for this collector. */
  sourceHints?: string[];

  /** Distinguishes normal domain discovery from targeted evidence recovery. */
  collectionMode?: CollectorCollectionMode;

  /** Optional per-run limits used without mutating singleton collector state. */
  limits?: CollectorLimits;
};

/**
 * Unified comment returned by every collector.
 *
 * languageCode is stored as a string because the database field
 * SocialComment.languageCode is a nullable String.
 *
 * @author Malak
 */
export type CollectorComment = {
  /**
   * External platform comment identifier.
   *
   * Combined with postId to prevent duplicate comments.
   */
  externalId: string;

  content: string;
  author?: string;

  /**
   * ISO or project language code.
   *
   * Examples:
   * - en
   * - ar
   * - EN
   * - AR
   */
  languageCode?: string;

  likesCount?: number;
  publishedAt?: Date;
};

/**
 * Unified post returned by every collector.
 *
 * The data-source identity is not included in every post because
 * the orchestration layer already knows which collector produced it.
 *
 * DataCollectionService resolves the collector sourceKey to
 * DataSource.id before saving the post.
 *
 * @author Malak
 */
export type CollectorPost = {
  /**
   * External platform post identifier.
   *
   * Combined with collectionJobId and dataSourceId to prevent
   * duplicate posts.
   */
  externalId: string;

  title?: string;
  content: string;
  author?: string;
  url?: string;

  country?: string;
  city?: string;
  region?: string;
  languageCode?: string;

  likesCount?: number;
  repliesCount?: number;

  publishedAt?: Date;

  /**
   * Optional source-provided tags used only during transient
   * relevance evaluation.
   *
   * These values are not persisted by SocialPostService unless
   * the database schema explicitly adds a tags field later.
   */
  tags?: string[];

  comments: CollectorComment[];
};