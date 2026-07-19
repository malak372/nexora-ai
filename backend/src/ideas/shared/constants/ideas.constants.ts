/**
 * Shared constants used across the ideas module.
 *
 * These constants must remain independent from generation,
 * publication, feedback, voting and output-specific logic.
 *
 * @author malak
 */
export const DEFAULT_IDEAS_PAGE = 1;

export const DEFAULT_IDEAS_PAGE_LIMIT = 20;

export const MAX_IDEAS_PAGE_LIMIT = 100;

export const MAX_IDEA_TITLE_LENGTH = 200;

export const MAX_IDEA_PROBLEM_STATEMENT_LENGTH = 5_000;

export const MAX_IDEA_OBJECTIVES_LENGTH = 5_000;

export const MAX_IDEA_TARGET_USERS_LENGTH = 3_000;

export const MAX_IDEA_ABSTRACT_LENGTH = 15_000;

/**
 * Maximum length used after normalizing an idea title.
 *
 * Normalized titles are used for duplicate detection and
 * comparison, not for display.
 */
export const MAX_NORMALIZED_IDEA_TITLE_LENGTH = 200;

/**
 * Owner type used when exposing an idea owner through
 * API responses or internal access checks.
 */
export const IDEA_OWNER_TYPES = {
  USER: 'USER',
  GUEST: 'GUEST',
} as const;