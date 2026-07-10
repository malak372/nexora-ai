import { CollectionSourceType } from '@prisma/client';

/**
 * Mapping of CollectionSourceType to human-readable platform names.
 *
 * This constant provides a mapping between the CollectionSourceType enum values
 *  and their corresponding human-readable platform names. It is used to display
 * platform names in the user interface and to ensure consistency across the application.
 *
 */
export const PLATFORM_NAMES: Record<CollectionSourceType, string> = {
  [CollectionSourceType.REDDIT]: 'Reddit',
  [CollectionSourceType.FACEBOOK]: 'Facebook',
  [CollectionSourceType.YOUTUBE]: 'YouTube',
  [CollectionSourceType.LINKEDIN]: 'LinkedIn',
  [CollectionSourceType.X]: 'X (Twitter)',
  [CollectionSourceType.INSTAGRAM]: 'Instagram',
  [CollectionSourceType.TELEGRAM]: 'Telegram',
  [CollectionSourceType.TIKTOK]: 'TikTok',

  [CollectionSourceType.GITHUB]: 'GitHub',
  [CollectionSourceType.STACKOVERFLOW]: 'Stack Overflow',
  [CollectionSourceType.DISCORD]: 'Discord',
  [CollectionSourceType.QUORA]: 'Quora',

  [CollectionSourceType.FORUM]: 'Forum',
  [CollectionSourceType.BLOG]: 'Blog',
  [CollectionSourceType.NEWS]: 'News',

  [CollectionSourceType.APP_STORE]: 'App Store',
  [CollectionSourceType.GOOGLE_PLAY]: 'Google Play',

  [CollectionSourceType.HACKER_NEWS]: 'Hacker News',
  [CollectionSourceType.PRODUCT_HUNT]: 'Product Hunt',
  [CollectionSourceType.DEV_TO]: 'DEV.to',

  [CollectionSourceType.OTHER]: 'Other',
};
