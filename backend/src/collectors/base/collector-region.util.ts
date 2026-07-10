/**
 * Utility class responsible for normalizing country names
 * into ISO 3166-1 alpha-2 region codes.
 *
 * This lightweight mapping is enough for the graduation project.
 * For full global support later, replace it with i18n-iso-countries.
 *
 * @author Malak
 */
export class CollectorRegionUtil {
  private static readonly REGION_MAP: Record<string, string> = {
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
    'u.s.': 'US',
    'u.s.a.': 'US',
    america: 'US',
    'united states': 'US',
    'united states of america': 'US',
    us: 'US',

    uk: 'GB',
    britain: 'GB',
    england: 'GB',
    'great britain': 'GB',
    'united kingdom': 'GB',
    gb: 'GB',

    turkey: 'TR',
    türkiye: 'TR',
    turkiye: 'TR',
    tr: 'TR',

    saudi: 'SA',
    ksa: 'SA',
    'saudi arabia': 'SA',
    sa: 'SA',

    uae: 'AE',
    emirates: 'AE',
    'united arab emirates': 'AE',
    ae: 'AE',
  };

  /**
   * Resolves a country name or abbreviation into
   * an ISO 3166-1 alpha-2 region code.
   */
  static resolveRegionCode(country?: string): string | undefined {
    if (!country) {
      return undefined;
    }

    const value = country.trim().toLowerCase();

    if (!value) {
      return undefined;
    }

    if (/^[a-z]{2}$/i.test(value)) {
      return value.toUpperCase();
    }

    return this.REGION_MAP[value];
  }
}
