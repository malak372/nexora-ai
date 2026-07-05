/**
 * Utility for building consistent cache keys
 * across all collectors.
 *
 * Example:
 *
 * youtube:search:health:ps:en
 *
 * github:comments:123456
 *
 * @author Malak
 */
export class CollectorCacheUtil {
  static build(
    platform: string,
    action: string,
    parts: Array<string | number | undefined | null>,
  ): string {
    return [
      platform,
      action,
      ...parts,
    ]
      .map((part) =>
        String(part ?? '')
          .trim()
          .toLowerCase(),
      )
      .join(':');
  }
}