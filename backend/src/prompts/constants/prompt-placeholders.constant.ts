/**
 * Required placeholder names that every prompt template must support.
 *
 * These placeholders are validated before rendering to ensure that
 * AI prompt templates remain compatible with the prompt builder.
 */
export const REQUIRED_PROMPT_PLACEHOLDERS = [
  'domain',
  'country',
  'city',
  'region',
  'platforms',
  'commentsCount',
  'sentimentStats',
  'keywords',
  'topics',
  'recurringProblems',
  'extractedNeeds',
  'featureRequests',
  'opportunities',
  'insights',
  'dataQuality',
  'samplePosts',
  'sampleComments',
  'existingIdea',
  'requestedOutputFormat',
] as const;

/**
 * Represents every supported prompt placeholder.
 */
export type PromptPlaceholder = (typeof REQUIRED_PROMPT_PLACEHOLDERS)[number];

/**
 * Values used to render a prompt template.
 */
export type PromptTemplateValues = Record<PromptPlaceholder, string>;
