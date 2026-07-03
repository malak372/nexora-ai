import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * X collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class XCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.X;
  protected readonly platformName = 'X';
}