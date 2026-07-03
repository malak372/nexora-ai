import { CollectionSourceType } from '@prisma/client';
import { CollectorInput, CollectorPost } from './collector.types';

/**
 * Base contract for all platform collectors.
 *
 * Every collector must:
 * - Declare its sourceType.
 * - Return posts in the unified CollectorPost format.
 *
 * @author Malak
 */
export interface SocialCollector {
  readonly sourceType: CollectionSourceType;

  collect(input: CollectorInput): Promise<CollectorPost[]>;
}