/**
 * Shared TypeScript contracts for structured AI outputs used by
 * idea generation and direct idea unlocking.
 *
 * These contracts represent application-level data after parsing
 * the raw provider response. Runtime validation must still be
 * performed before any AI-generated value is trusted or persisted.
 *
 * @author Malak
 */

/**
 * Primitive values supported by JSON.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON-compatible object representation.
 */
export type JsonObject = {
  [key: string]: JsonValue;
};

/**
 * JSON-compatible array representation.
 */
export type JsonArray = JsonValue[];

/**
 * Any value that can be represented safely as JSON.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Stable persistence keys supported by advanced generated-idea
 * outputs.
 *
 * These values are stored in GeneratedOutput.outputKey and shared
 * across:
 * - AI-output parsing.
 * - Business-level output validation.
 * - Premium-output validation.
 * - Idea persistence.
 * - Unlock persistence.
 * - API response mapping.
 *
 * Existing values should not be renamed casually because they may
 * already be persisted in the database or consumed by frontend
 * applications.
 */
export type IdeaAdvancedOutputKey =
  | 'full-abstract'
  | 'technology-stack'
  | 'system-architecture'
  | 'database-design'
  | 'mvp-features'
  | 'business-model'
  | 'value-proposition'
  | 'revenue-model'
  | 'local-regulations'
  | 'budget-estimation'
  | 'feasibility-assessment'
  | 'implementation-timeline'
  | 'market-potential'
  | 'nlp-executive-summary'
  | 'community-feedback-summary';

/**
 * Supported property names returned by premium-generation and
 * idea-unlock structured AI schemas.
 *
 * Each field maps to one stable IdeaAdvancedOutputKey through the
 * shared advanced-output definitions.
 */
export type IdeaAdvancedOutputField =
  | 'fullAbstract'
  | 'technologyStack'
  | 'systemArchitecture'
  | 'databaseDesign'
  | 'mvpFeatures'
  | 'businessModel'
  | 'valueProposition'
  | 'revenueModel'
  | 'localRegulations'
  | 'budgetEstimation'
  | 'feasibilityAssessment'
  | 'implementationTimeline'
  | 'marketPotential'
  | 'nlpExecutiveSummary'
  | 'communityFeedbackSummary';

/**
 * Core idea information returned by a new-idea generation
 * operation.
 *
 * The following fields are required for every generated idea:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 *
 * Abstract fields remain optional at this shared contract level
 * because their requiredness depends on IdeaGenerationType:
 *
 * - GUEST_FREE requires limitedAbstract and partialAbstract.
 * - NORMAL_FREE requires partialAbstract.
 * - PREMIUM_CREDIT requires fullAbstract.
 *
 * The AI-output validation stage is responsible for enforcing the
 * correct tier-specific contract after entitlement resolution.
 */
export type CoreIdeaAiOutput = {
  /**
   * Human-readable software-project title.
   */
  title: string;

  /**
   * Clear description of the real-world problem addressed by the
   * generated software project.
   */
  problemStatement: string;

  /**
   * Main project goals and expected outcomes.
   */
  objectives: string[];

  /**
   * Primary users, customers, businesses, or organizations
   * targeted by the project.
   */
  targetUsers: string[];

  /**
   * Limited abstract exposed to unauthenticated guest users.
   *
   * Guest generation may also persist partialAbstract internally
   * so it becomes available after registration and successful
   * guest-idea transfer.
   */
  limitedAbstract?: string;

  /**
   * Partial abstract exposed to authenticated free-tier users.
   */
  partialAbstract?: string;

  /**
   * Complete abstract exposed for premium-generated or directly
   * unlocked ideas.
   */
  fullAbstract?: string;
};

/**
 * Normalized representation of one advanced generated-idea
 * output.
 *
 * Advanced outputs are persisted individually through the
 * GeneratedOutput Prisma model.
 */
export type AdvancedIdeaAiOutput = {
  /**
   * Stable application-level and persistence-level output key.
   */
  outputKey: IdeaAdvancedOutputKey;

  /**
   * Human-readable title displayed for the generated output.
   */
  title: string;

  /**
   * Plain-text or Markdown representation of the generated
   * output.
   */
  content: string;

  /**
   * Optional machine-readable representation of the output.
   *
   * Structured values such as technology stacks, MVP features,
   * timelines, or architecture sections may be persisted both as
   * human-readable Markdown and JSON-compatible structured data.
   */
  structuredContent?: JsonObject | JsonArray;
};

/**
 * Complete normalized result produced when parsing a newly
 * generated idea.
 */
export type ParsedIdeaAiOutput = {
  /**
   * Required core idea information and any tier-specific abstract
   * fields returned by the AI.
   */
  coreIdea: CoreIdeaAiOutput;

  /**
   * Normalized advanced outputs.
   *
   * This array is:
   * - Empty for guest generation.
   * - Empty for normal-free generation.
   * - Complete for premium-credit generation.
   */
  advancedOutputs: AdvancedIdeaAiOutput[];
};

/**
 * Complete normalized result produced when parsing a direct
 * idea-unlock response.
 *
 * Unlock output intentionally excludes existing core idea fields
 * such as:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - partialAbstract
 *
 * Those fields already belong to the existing free idea and must
 * not be overwritten by the unlock operation.
 */
export type ParsedIdeaUnlockAiOutput = {
  /**
   * Complete abstract generated for the existing free idea.
   */
  fullAbstract: string;

  /**
   * Advanced outputs generated for the existing idea.
   *
   * The complete abstract is also represented in this collection
   * using the `full-abstract` output key. This allows persistence
   * services to use one unified GeneratedOutput contract for all
   * unlock outputs.
   */
  advancedOutputs: AdvancedIdeaAiOutput[];
};

/**
 * Raw AI response accepted by idea-output parsers.
 *
 * Responses may arrive as:
 * - Raw JSON text.
 * - An already parsed JSON object.
 * - An already parsed JSON array.
 *
 * The parser must validate the root structure before using it.
 */
export type RawIdeaAiOutput = string | JsonObject | JsonArray;

/**
 * Successful result returned by the non-throwing new-idea parser.
 */
export type SuccessfulIdeaAiOutputParseResult = {
  /**
   * Indicates that parsing, normalization, and business-level
   * validation succeeded.
   */
  success: true;

  /**
   * Parsed and normalized generated-idea output.
   */
  output: ParsedIdeaAiOutput;

  /**
   * Indicates whether the parser itself repaired the provider
   * output.
   *
   * Repair is currently handled by the central AI runtime rather
   * than this parser, so the value is always false.
   */
  repaired: false;

  /**
   * A successful parse contains no validation errors.
   */
  errors: [];
};

/**
 * Failed result returned by the non-throwing new-idea parser.
 */
export type FailedIdeaAiOutputParseResult = {
  /**
   * Indicates that parsing, normalization, or business-level
   * validation failed.
   */
  success: false;

  /**
   * Failed parsing does not provide normalized output.
   */
  output: null;

  /**
   * Indicates whether the parser itself repaired the provider
   * output.
   *
   * The parser does not currently perform repair.
   */
  repaired: false;

  /**
   * Safe validation-error messages suitable for logging or
   * internal error handling.
   *
   * These messages must not expose provider credentials, private
   * prompts, or other sensitive runtime data.
   */
  errors: string[];
};

/**
 * Discriminated result returned by
 * IdeaAiOutputParserService.parse().
 *
 * Consumers should narrow the result through `success` before
 * accessing output.
 */
export type IdeaAiOutputParseResult =
  | SuccessfulIdeaAiOutputParseResult
  | FailedIdeaAiOutputParseResult;

/**
 * Successful result returned by the non-throwing direct-unlock
 * output parser.
 */
export type SuccessfulIdeaUnlockOutputParseResult = {
  /**
   * Indicates that parsing, normalization, and validation
   * succeeded.
   */
  success: true;

  /**
   * Parsed and normalized direct-unlock output.
   */
  output: ParsedIdeaUnlockAiOutput;

  /**
   * Indicates whether the parser itself repaired the provider
   * output.
   *
   * Repair is currently delegated to the central AI runtime.
   */
  repaired: false;

  /**
   * A successful parse contains no validation errors.
   */
  errors: [];
};

/**
 * Failed result returned by the non-throwing direct-unlock output
 * parser.
 */
export type FailedIdeaUnlockOutputParseResult = {
  /**
   * Indicates that parsing, normalization, or validation failed.
   */
  success: false;

  /**
   * Failed parsing does not provide normalized output.
   */
  output: null;

  /**
   * Indicates whether the parser itself repaired the provider
   * output.
   *
   * The parser does not currently perform repair.
   */
  repaired: false;

  /**
   * Safe validation-error messages suitable for logging or
   * internal error handling.
   */
  errors: string[];
};

/**
 * Discriminated result returned by the direct-unlock output
 * parser.
 *
 * Consumers should narrow the result through `success` before
 * accessing output.
 */
export type IdeaUnlockOutputParseResult =
  | SuccessfulIdeaUnlockOutputParseResult
  | FailedIdeaUnlockOutputParseResult;
