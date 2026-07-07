/**
 * Utility for building consistent cache keys
 * across all collectors.
 *
 * Examples:
 * - youtube:search:health:ps:en
 * - github:comments:123456
 *
 * @author Malak
 */
export class CollectorCacheUtil {
  /**
   * Builds a normalized cache key.
   *
   * Empty or undefined parts are removed to avoid keys
   * containing unnecessary empty sections.
   */
  static build(
    platform: string,
    action: string,
    parts: Array<string | number | undefined | null>,
  ): string {
    return [platform, action, ...parts]
      .map((part) =>
        String(part ?? '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean)
      .join(':');
  }
}