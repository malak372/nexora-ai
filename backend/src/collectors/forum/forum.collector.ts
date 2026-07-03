import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Forum collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class ForumCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.FORUM;
  protected readonly platformName = 'Forum';
}