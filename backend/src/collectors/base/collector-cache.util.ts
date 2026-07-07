type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * Utility for building and storing collector cache entries.
 *
 * @author Malak
 */
export class CollectorCacheUtil {
  private static readonly cache = new Map<string, CacheEntry<unknown>>();

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

  static get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  static set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  static delete(key: string): void {
    this.cache.delete(key);
  }

  static clear(): void {
    this.cache.clear();
  }
}