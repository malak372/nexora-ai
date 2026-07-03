import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Apple App Store collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class AppStoreCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.APP_STORE;
  protected readonly platformName = 'App Store';
}