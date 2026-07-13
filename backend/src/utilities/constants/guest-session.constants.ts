/**
 * Name of the secure cookie used to identify one guest session.
 *
 * Shared by the Ideas and Authentication modules so both flows
 * always read and write the same cookie.
 *
 * @author Malak
 */
export const GUEST_SESSION_COOKIE_NAME = 'nexora_guest_session';

/**
 * Maximum lifetime of one guest session in days.
 */
export const GUEST_SESSION_LIFETIME_DAYS = 30;
