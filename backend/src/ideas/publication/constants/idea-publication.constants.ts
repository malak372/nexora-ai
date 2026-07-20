/**
 * Stable audience-rule types supported by selected-audience publications.
 *
 * These values are persisted in IdeaPublicationAudience.audienceType.
 * Existing values should not be renamed without a data migration.
 *
 * @author Malak
 */
export const IDEA_PUBLICATION_AUDIENCE_TYPES = [
  'user-type',
  'specific-user',
  'domain-interest',
] as const;

/**
 * Languages supported by AI-generated public descriptions.
 *
 * @author Malak
 */
export const PUBLICATION_DESCRIPTION_LANGUAGES = ['AR', 'EN'] as const;

/**
 * Default approximate word limit used for generated public descriptions.
 *
 * @author Malak
 */
export const DEFAULT_PUBLICATION_DESCRIPTION_MAX_WORDS = 100;

/**
 * Minimum accepted public-description word limit.
 */
export const MIN_PUBLICATION_DESCRIPTION_WORDS = 30;

/**
 * Maximum accepted public-description word limit.
 */
export const MAX_PUBLICATION_DESCRIPTION_WORDS = 200;

/**
 * Maximum number of audience rules accepted for one publication.
 */
export const MAX_PUBLICATION_AUDIENCES = 50;

/**
 * Maximum AI output-token allocation for a public description.
 */
export const PUBLICATION_DESCRIPTION_MAX_OUTPUT_TOKENS = 350;

/**
 * Estimated output-token count used by model routing.
 */
export const PUBLICATION_DESCRIPTION_ESTIMATED_OUTPUT_TOKENS = 180;

/**
 * Sampling temperature used for concise public descriptions.
 */
export const PUBLICATION_DESCRIPTION_TEMPERATURE = 0.4;