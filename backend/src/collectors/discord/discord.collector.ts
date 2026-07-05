import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Discord collector.
 *
 * Discord is intentionally unsupported because it does not provide
 * a public search API for collecting discussions across public servers.
 *
 * Unlike platforms such as GitHub, Reddit, Stack Overflow, and
 * Discourse-based forums, Discord only allows bots to access messages
 * from servers where they have been explicitly invited with the
 * appropriate permissions.
 *
 * Supporting Discord would require:
 * - A dedicated Discord Bot.
 * - User-owned or administrator-approved servers.
 * - Explicit channel permissions.
 * - Server-specific configuration.
 *
 * Since Nexora AI focuses on collecting publicly searchable community
 * discussions, Discord is currently excluded from automated collection.
 *
 * This collector can be implemented in the future if server-specific
 * data collection becomes a project requirement.
 *
 * @author Malak
 */
@Injectable()
export class DiscordCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.DISCORD;

  protected readonly platformName = 'Discord';
}