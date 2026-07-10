import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Telegram collector.
 *
 * Placeholder collector for Telegram integration.
 *
 * This collector is intentionally disabled until Telegram integration
 * is implemented.
 *
 * Future implementation may use the Telegram Bot API or Telegram Client API
 * to collect public messages and comments from supported public channels
 * and groups.
 *
 * Planned features include:
 * - Public channel message collection.
 * - Public discussion comments collection.
 * - Retry with exponential backoff.
 * - In-memory caching.
 * - Relevance scoring.
 * - Spam and low-value content filtering.
 * - Deduplication.
 *
 * @author Malak
 */
@Injectable()
export class TelegramCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.TELEGRAM;

  protected readonly platformName = 'Telegram';
}
