import { CollectorInput, CollectorPost } from '../../base/collector.types';

/**
 * Forum adapter contract.
 *
 * A forum adapter represents one forum engine, such as:
 * - Discourse
 * - phpBB
 * - NodeBB
 * - Flarum
 *
 * The main ForumCollector owns the DataSource identity.
 *
 * @author Malak
 */
export interface ForumAdapter {
  /**
   * Human-readable forum-engine name.
   */
  readonly engineName: string;

  /**
   * Collects discussions from one forum URL.
   */
  collect(
    forumUrl: string,
    searchQuery: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]>;
}
