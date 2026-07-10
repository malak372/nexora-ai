import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Reddit collector.
 *
 * Placeholder collector for Reddit integration.
 *
 * This collector is intentionally disabled because collecting public
 * Reddit posts reliably requires access to Reddit API with OAuth,
 * valid credentials, and compliance with Reddit API rules.
 *
 * Reddit requires:
 * - A registered Reddit developer application.
 * - Valid client ID and client secret.
 * - OAuth access token.
 * - Proper User-Agent header.
 * - Compliance with Reddit API rate limits and policies.
 *
 * Until these requirements are completed, public Reddit content
 * cannot be collected reliably because public JSON endpoints may return
 * 403 errors or network security blocks.
 *
 * Once the required access is available, this collector can be
 * replaced with a full Reddit API implementation supporting:
 * - Public post search.
 * - Subreddit search.
 * - Comment collection.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Relevance scoring.
 * - Spam and low-value content filtering.
 * - Deduplication.
 *
 * @author Malak
 */
@Injectable()
export class RedditCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.REDDIT;

  protected readonly platformName = 'Reddit';
}
