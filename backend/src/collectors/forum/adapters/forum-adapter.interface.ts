import { CollectorInput, CollectorPost } from '../../base/collector.types';

/**
 * Forum adapter interface.
 *
 * Defines the contract for forum adapters that collect
 * public forum discussions and replies from a specific forum engine.
 *
 * @author Malak
 */
export interface ForumAdapter {
  readonly engineName: string;

  collect(
    forumUrl: string,
    searchQuery: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]>;
}