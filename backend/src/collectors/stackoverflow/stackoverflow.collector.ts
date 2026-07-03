import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Stack Overflow collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class StackOverflowCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.STACKOVERFLOW;
  protected readonly platformName = 'StackOverflow';
}