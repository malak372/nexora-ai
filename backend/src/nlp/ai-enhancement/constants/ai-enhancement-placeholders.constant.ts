/**
 * Required placeholders supported by the NLP AI-enhancement prompt
 * template.
 *
 * This placeholder contract is intentionally separated from the
 * idea-generation prompt contract because both operations have
 * different inputs, responsibilities, and expected outputs.
 *
 * The placeholder order mirrors the logical structure of the
 * rendered enhancement prompt.
 *
 * @author Eman
 */
export const REQUIRED_AI_ENHANCEMENT_PLACEHOLDERS = [
  'decisionReasons',
  'complexityMetrics',
  'qualityMetrics',

  'sentimentStats',
  'keywords',
  'topics',

  'recurringProblems',
  'extractedNeeds',
  'featureRequests',
  'opportunities',
  'insights',

  'evidence',

  'requestedOutputFormat',
] as const;

/**
 * Represents every placeholder supported by the NLP AI-enhancement
 * prompt template.
 */
export type AiEnhancementPromptPlaceholder =
  (typeof REQUIRED_AI_ENHANCEMENT_PLACEHOLDERS)[number];

/**
 * Values used to render one NLP AI-enhancement prompt.
 *
 * Every supported placeholder must be replaced with its rendered
 * string value before the prompt is submitted to an AI client.
 */
export type AiEnhancementPromptTemplateValues = Record<
  AiEnhancementPromptPlaceholder,
  string
>;
