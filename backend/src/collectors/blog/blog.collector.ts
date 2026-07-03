import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Blog collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class BlogCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.BLOG;
  protected readonly platformName = 'Blog';
}