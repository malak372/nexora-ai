import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Discord collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class DiscordCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.DISCORD;
  protected readonly platformName = 'Discord';
}