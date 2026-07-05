import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Quora collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class QuoraCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.QUORA;
  protected readonly platformName = 'Quora';
}
