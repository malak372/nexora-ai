import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * LinkedIn collector.
 *
 * Placeholder collector for LinkedIn integration.
 *
 * This collector is intentionally disabled because collecting public
 * LinkedIn posts and comments requires access to LinkedIn APIs that are
 * restricted to approved applications and partner programs.
 *
 * LinkedIn requires:
 * - Application review and approval.
 * - Appropriate LinkedIn API products and permissions.
 * - Compliance with LinkedIn Developer Program policies.
 *
 * Until these requirements are completed, LinkedIn public content
 * cannot be collected reliably from arbitrary public profiles or pages.
 *
 * Once the required permissions are granted, this collector can be
 * replaced with a full LinkedIn API implementation supporting:
 * - Public organization posts.
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
export class LinkedInCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.LINKEDIN;

  protected readonly platformName = 'LinkedIn';
}
