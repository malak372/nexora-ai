import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Facebook collector placeholder.
 *
 * Requires Meta Graph API permissions before real collection is enabled.
 *
 * @author Malak
 */
@Injectable()
export class FacebookCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.FACEBOOK;
  protected readonly platformName = 'Facebook';
}