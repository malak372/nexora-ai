/**
 * Shared constants used throughout the Payment module.
 *
 * These constants centralize payment-related configuration such as:
 * - Credit purchase limits.
 * - Default pagination values.
 * - Payment metadata keys used by external payment providers.
 *
 * Keeping these values in one place improves maintainability,
 * consistency, and prevents magic numbers across the codebase.
 *
 * @author Eman
 */

/**
 * Global key used to retrieve the single SystemSetting record.
 *
 * Nexora AI stores one global SystemSetting row containing
 * platform-wide payment, credit, bonus, and direct-unlock settings.
 */
export const GLOBAL_SYSTEM_SETTINGS_KEY = 'GLOBAL';

/**
 * Default currency used for payment operations.
 *
 * The current payment model uses USD for:
 * - Credit purchases.
 * - Direct idea unlock payments.
 */
export const DEFAULT_PAYMENT_CURRENCY = 'USD';

/**
 * Minimum number of credits allowed in a single purchase request.
 *
 * One credit allows one premium idea generation.
 */
export const MIN_CREDITS_PER_PURCHASE = 1;

/**
 * Maximum number of credits allowed in a single purchase request.
 *
 * This protects the payment endpoint from accidental,
 * malformed, or abusive requests.
 */
export const MAX_CREDITS_PER_PURCHASE = 100;

/**
 * Default page number used when retrieving payment history.
 */
export const DEFAULT_PAYMENT_PAGE = 1;

/**
 * Default number of payment records returned per page.
 */
export const DEFAULT_PAYMENT_PAGE_SIZE = 10;

/**
 * Maximum number of payment records allowed per page.
 *
 * This prevents excessively large database queries.
 */
export const MAX_PAYMENT_PAGE_SIZE = 100;

/**
 * Metadata keys attached to external payment sessions.
 *
 * These values allow webhook events from payment providers
 * to be safely matched with internal Nexora AI payment records.
 *
 * Sensitive information such as passwords, API keys,
 * payment-card details, or access tokens must never be stored
 * in payment metadata.
 */
export const PAYMENT_METADATA_KEYS = {
  PAYMENT_ID: 'paymentId',
  USER_ID: 'userId',
  IDEA_ID: 'ideaId',
  PAYMENT_PURPOSE: 'paymentPurpose',
} as const;

/**
 * Represents every supported payment metadata key.
 */
export type PaymentMetadataKey =
  (typeof PAYMENT_METADATA_KEYS)[keyof typeof PAYMENT_METADATA_KEYS];
