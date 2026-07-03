import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * YouTube collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class YouTubeCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.YOUTUBE;
  protected readonly platformName = 'YouTube';
}