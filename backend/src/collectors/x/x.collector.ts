import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * X collector.
 *
 * Placeholder collector for X integration.
 *
 * This collector is intentionally disabled because collecting public
 * X posts requires access to X API v2 with the appropriate API plan,
 * credentials, and available API credits.
 *
 * X requires:
 * - A registered developer application.
 * - Valid API credentials.
 * - An API plan that supports Search endpoints.
 * - Available API credits and compliance with X Developer policies.
 *
 * Until these requirements are completed, public X content
 * cannot be collected reliably.
 *
 * Once the required access is available, this collector can be
 * replaced with a full X API implementation supporting:
 * - Public post search.
 * - Retry with exponential backoff.
 * - In-memory caching.
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