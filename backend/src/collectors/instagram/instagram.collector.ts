import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Instagram collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class InstagramCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.INSTAGRAM;
  protected readonly platformName = 'Instagram';
}