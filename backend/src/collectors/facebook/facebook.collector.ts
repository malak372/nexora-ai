import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Facebook collector.
 *
 * Placeholder collector for Facebook integration.
 *
 * This collector is intentionally disabled because collecting public
 * Facebook Page posts and comments requires Meta Graph API access with
 * the Page Public Content Access feature.
 *
 * Meta requires:
 * - App Review.
 * - Business Verification.
 * - Page Public Content Access approval.
 *
 * Until these requirements are completed, Facebook public content
 * cannot be collected reliably from arbitrary public pages.
 *
 * Once the required permissions are granted, this collector can be
 * replaced with a full Graph API implementation supporting:
 * - Public Page posts.
 * - Public Page comments.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Relevance scoring.
 * - Spam and low-value content filtering.
 * - Deduplication.
 *
 * @author Malak
 */
@Injectable()
export class FacebookCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.FACEBOOK;

  protected readonly platformName = 'Facebook';
}
