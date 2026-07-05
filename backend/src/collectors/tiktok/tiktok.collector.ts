import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * TikTok collector.
 *
 * Placeholder collector for TikTok integration.
 *
 * This collector is intentionally disabled because collecting public
 * TikTok videos and comments requires access to TikTok APIs that are
 * restricted to approved applications and supported use cases.
 *
 * TikTok requires:
 * - Application review and approval.
 * - Appropriate TikTok API products and permissions.
 * - Compliance with TikTok Developer policies.
 *
 * Until these requirements are completed, TikTok public content
 * cannot be collected reliably from arbitrary public accounts.
 *
 * Once the required permissions are granted, this collector can be
 * replaced with a full TikTok API implementation supporting:
 * - Public videos.
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
export class TikTokCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.TIKTOK;

  protected readonly platformName = 'TikTok';
}