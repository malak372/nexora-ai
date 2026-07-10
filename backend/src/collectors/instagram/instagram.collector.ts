import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Instagram collector.
 *
 * Placeholder collector for Instagram integration.
 *
 * This collector is intentionally disabled because collecting public
 * Instagram posts and comments requires the Instagram Graph API with
 * the appropriate Meta permissions.
 *
 * Meta requires:
 * - App Review.
 * - Business Verification.
 * - Instagram Public Content Access (when applicable).
 * - A linked Instagram Professional (Business or Creator) account.
 *
 * Until these requirements are completed, Instagram public content
 * cannot be collected reliably from arbitrary public accounts.
 *
 * Once the required permissions are granted, this collector can be
 * replaced with a full Instagram Graph API implementation supporting:
 * - Public account posts.
 * - Public comments.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Relevance scoring.
 * - Spam and low-value content filtering.
 * - Deduplication.
 *
 * @author Malak
 */
@Injectable()
export class InstagramCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.INSTAGRAM;

  protected readonly platformName = 'Instagram';
}
