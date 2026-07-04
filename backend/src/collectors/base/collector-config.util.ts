import { ConfigService } from '@nestjs/config';

/**
 * Utility for reading CSV configuration values
 * from environment variables.
 *
 * Supports:
 * - Common collector configuration.
 * - Platform-specific configuration.
 * - Automatic deduplication.
 *
 * @author Malak
 */
export class CollectorConfigUtil {
  /**
   * Reads a comma-separated environment variable.
   *
   * Example:
   * KEY=a,b,c
   *
   * returns:
   * ['a','b','c']
   */
  static getCsv(
    config: ConfigService,
    key: string,
  ): string[] {
    return (config.get<string>(key) ?? '')
      .split(',')
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * Merges a common configuration list with a
   * platform-specific list.
   *
   * Duplicate values are removed.
   */
  static getMergedCsv(
    config: ConfigService,
    commonKey: string,
    platformKey: string,
  ): string[] {
    return Array.from(
      new Set([
        ...this.getCsv(config, commonKey),
        ...this.getCsv(config, platformKey),
      ]),
    );
  }
}