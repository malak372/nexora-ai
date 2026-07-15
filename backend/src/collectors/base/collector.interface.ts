import {
  CollectorInput,
  CollectorPost,
} from './collector.types';

/**
 * Base contract implemented by every data collector.
 *
 * Each collector exposes a stable sourceKey that must match
 * the corresponding DataSource.key stored in the database.
 *
 * Examples:
 * - youtube
 * - github
 * - app-store
 * - google-play
 * - dev-to
 *
 * Adding a new collector does not require:
 * - Adding a Prisma enum value.
 * - Updating a centralized platform enum.
 * - Updating a platform-name mapping.
 *
 * A new collector only needs to:
 * - Implement this interface.
 * - Be registered as a NestJS provider.
 * - Be registered in CollectorsFactory.
 * - Have a matching DataSource database row.
 *
 * @author Malak
 */
export interface SocialCollector {
  /**
   * Stable backend registry key.
   *
   * The value is normalized by CollectorsFactory before lookup,
   * but collectors should define it using lowercase kebab-case.
   *
   * Must match DataSource.key.
   *
   * Examples:
   * - youtube
   * - github
   * - hacker-news
   * - product-hunt
   */
  readonly sourceKey: string;

  /**
   * Collects and normalizes public posts and comments
   * from the external data source.
   *
   * @param input Collection request configuration.
   * @returns Unified collected posts.
   */
  collect(
    input: CollectorInput,
  ): Promise<CollectorPost[]>;
}