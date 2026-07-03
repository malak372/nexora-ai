import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Google Play collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class GooglePlayCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.GOOGLE_PLAY;
  protected readonly platformName = 'Google Play';
}