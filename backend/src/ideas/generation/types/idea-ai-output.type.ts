/**
 * Core idea output expected from the AI model.
 *
 * This output is generated for:
 * - Guest generation.
 * - Registered free generation.
 * - Premium-credit generation.
 *
 * The service layer decides which fields may be returned to
 * the requester according to the generation entitlement.
 *
 * @author Malak
 */
export type CoreIdeaAiOutput = {
  /**
   * Human-readable project title.
   */
  title: string;

  /**
   * Problem addressed by the generated project.
   */
  problemStatement: string;

  /**
   * Main project objectives.
   */
  objectives: string[];

  /**
   * Intended users or beneficiaries.
   */
  targetUsers: string[];

  /**
   * Short abstract shown to guest users.
   */
  limitedAbstract: string;

  /**
   * Partial abstract shown to registered free users.
   */
  partialAbstract: string;

  /**
   * Optional full abstract.
   *
   * This may be generated directly for premium generation or
   * created later through a dedicated output-generation stage.
   */
  fullAbstract?: string;
};

/**
 * Generic generated advanced-output representation.
 *
 * Advanced outputs are persisted individually through the
 * GeneratedOutput model using stable output keys.
 *
 * @author Malak
 */
export type AdvancedIdeaAiOutput = {
  /**
   * Stable application-level output key.
   *
   * Examples:
   * - full-abstract
   * - technology-stack
   * - system-architecture
   * - database-design
   * - business-model
   */
  outputKey: string;

  /**
   * Human-readable output title.
   */
  title: string;

  /**
   * Plain-text or Markdown representation.
   */
  content: string;

  /**
   * Optional machine-readable output.
   */
  structuredContent?: Record<string, unknown> | unknown[];
};

/**
 * Complete normalized result produced by the AI-output parser.
 *
 * @author Malak
 */
export type ParsedIdeaAiOutput = {
  coreIdea: CoreIdeaAiOutput;
  advancedOutputs: AdvancedIdeaAiOutput[];
};

/**
 * Raw AI response before validation and normalization.
 *
 * The response may arrive as:
 * - JSON string.
 * - Parsed object.
 * - Provider-specific wrapper.
 *
 * @author Malak
 */
export type RawIdeaAiOutput =
  | string
  | Record<string, unknown>
  | unknown[];

/**
 * Result returned by the AI-output parsing service.
 *
 * @author Malak
 */
export type IdeaAiOutputParseResult =
  | {
      success: true;
      output: ParsedIdeaAiOutput;
      repaired: boolean;
      errors: [];
    }
  | {
      success: false;
      output: null;
      repaired: boolean;
      errors: string[];
    };