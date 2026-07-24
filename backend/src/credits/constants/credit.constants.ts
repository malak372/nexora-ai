/**
 * Number of credits required to generate one premium idea.
 *
 * One premium idea always consumes exactly one credit.
 * The monetary price of each credit is configured separately
 * through the global system settings.
 */
export const PREMIUM_IDEA_CREDIT_COST = 1;

/**
 * Remaining credit balance at which the system considers
 * the user's balance low.
 *
 * A low-credit alert should be triggered when the balance
 * is greater than zero and less than or equal to this value.
 */
export const LOW_CREDIT_BALANCE_THRESHOLD = 1;