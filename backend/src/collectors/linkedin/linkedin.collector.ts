import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * LinkedIn collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class LinkedInCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.LINKEDIN;
  protected readonly platformName = 'LinkedIn';
}