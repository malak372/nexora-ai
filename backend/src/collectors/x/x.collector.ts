import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * X collector.
 *
 * Placeholder collector for X integration.
 *
 * This collector is intentionally disabled because collecting public
 * posts from X requires access to paid or approved X API products,
 * appropriate permissions, and compliance with X Developer policies.
 *
 * X requires:
 * - A registered developer application.
 * - A valid X API access tier.
 * - A bearer token with the required search permissions.
 * - Compliance with X Developer Agreement and policies.
 *
 * Until these requirements are completed, public X posts cannot be
 * collected reliably through the official API.
 *
 * Once the required access is available, this collector can be replaced
 * with a full X API v2 implementation supporting:
 * - Recent post search.
 * - Full-archive post search when available.
 * - Public engagement metrics.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Language filtering.
 * - Relevance scoring.
 * - Spam and low-value content filtering.
 * - Deduplication.
 *
 * @author Malak
 */
@Injectable()
export class XCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.X;

  protected readonly platformName = 'X';
}
