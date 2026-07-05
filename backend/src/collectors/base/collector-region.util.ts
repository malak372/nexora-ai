/**
 * Utility class responsible for normalizing country names
 * into ISO 3166-1 alpha-2 region codes.
 *
 * Features:
 * - Accepts common country names, abbreviations, and aliases.
 * - Returns standardized region codes required by external APIs.
 * - Provides a single mapping source shared across all collectors.
 *
 * This utility helps ensure consistent region handling regardless
 * of how users specify their country.
 *
 * @author Malak
 */
export class CollectorRegionUtil {
  /**
   * Resolves a country name or abbreviation into
   * an ISO 3166-1 alpha-2 region code.
   *
   * Supported examples:
   * - Palestine → PS
   * - Jordan → JO
   * - Egypt → EG
   * - Israel → IL
   * - United States → US
   * - United Kingdom → GB
   * - Turkey → TR
   * - Saudi Arabia → SA
   * - United Arab Emirates → AE
   *
   * The lookup is:
   * - Case-insensitive.
   * - Whitespace tolerant.
   * - Supports common aliases and abbreviations.
   *
   * Returns undefined if the country is not recognized.
   *
   * @param country User-provided country name or abbreviation.
   * @returns ISO 3166-1 alpha-2 region code or undefined.
   */
  static resolveRegionCode(country?: string): string | undefined {
    if (!country) return undefined;

    const value = country.trim().toLowerCase();

    const map: Record<string, string> = {
      palestine: 'PS',
      'state of palestine': 'PS',
      ps: 'PS',

      jordan: 'JO',
      jo: 'JO',

      egypt: 'EG',
      eg: 'EG',

      israel: 'IL',
      il: 'IL',

      usa: 'US',
      'united states': 'US',
      'united states of america': 'US',
      us: 'US',

      uk: 'GB',
      'united kingdom': 'GB',
      gb: 'GB',

      turkey: 'TR',
      türkiye: 'TR',
      tr: 'TR',

      saudi: 'SA',
      'saudi arabia': 'SA',
      sa: 'SA',

      uae: 'AE',
      'united arab emirates': 'AE',
      ae: 'AE',
    };

    return map[value];
  }
}