import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Telegram collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class TelegramCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.TELEGRAM;
  protected readonly platformName = 'Telegram';
}