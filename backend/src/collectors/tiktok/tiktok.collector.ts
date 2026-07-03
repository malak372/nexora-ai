import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * TikTok collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class TikTokCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.TIKTOK;
  protected readonly platformName = 'TikTok';
}