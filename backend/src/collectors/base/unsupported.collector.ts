import { NotImplementedException } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { SocialCollector } from './collector.interface';
import { CollectorInput, CollectorPost } from './collector.types';

/**
 * Base class for collectors that are planned but not implemented yet.
 *
 * This keeps the architecture ready for future integrations while clearly
 * informing the admin that API permissions or implementation are still needed.
 *
 * @author Malak
 */
export abstract class UnsupportedCollector implements SocialCollector {
  abstract readonly sourceType: CollectionSourceType;
  protected abstract readonly platformName: string;

  collect(_input: CollectorInput): Promise<CollectorPost[]> {
    throw new NotImplementedException(
      `${this.platformName} collector is not implemented yet or requires API permissions.`,
    );
  }
}