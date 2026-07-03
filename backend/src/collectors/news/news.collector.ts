import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * News collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class NewsCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.NEWS;
  protected readonly platformName = 'News';
}