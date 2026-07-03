import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * GitHub collector placeholder.
 *
 * @author Malak
 */
@Injectable()
export class GitHubCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.GITHUB;
  protected readonly platformName = 'GitHub';
}