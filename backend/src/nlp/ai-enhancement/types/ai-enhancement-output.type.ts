/**
 * Types describing the structured output produced by the NLP
 * AI-enhancement layer.
 *
 * These contracts contain semantic improvements only. Statistical
 * values, frequencies, raw evidence, and source samples remain owned
 * by the rule-based NLP pipeline.
 *
 * Every AI-enhanced analytical item must reference existing evidence
 * identifiers supplied in the enhancement prompt. This prevents the
 * AI layer from introducing unsupported evidence.
 *
 * @author Eman
 */

/**
 * Common contract for AI-enhanced items supported by existing
 * rule-based evidence.
 */
type EvidenceSupportedAiItem = {
  /**
   * Identifiers of existing evidence samples supporting the item.
   */
  readonly supportingEvidenceIds: readonly string[];
};

/**
 * Common contract for evidence-supported items that expose
 * a confidence score.
 */
type ConfidentEvidenceSupportedAiItem =
  EvidenceSupportedAiItem & {
    /**
     * Confidence score in the inclusive range [0, 1].
     *
     * Runtime validation is performed by the structured-output
     * validator.
     */
    readonly confidence: number;
  };

/**
 * Represents one recurring problem proposed or refined by AI.
 */
export type AiEnhancedRecurringProblem =
  EvidenceSupportedAiItem & {
    /**
     * Normalized and concise problem title.
     */
    readonly title: string;

    /**
     * Semantic explanation that clarifies the problem.
     *
     * Null is used when no evidence-supported explanation is available.
     */
    readonly description: string | null;

    /**
     * Estimated severity score in the inclusive range [0, 1].
     */
    readonly severity: number;
  };

/**
 * Represents one user need identified or refined by AI.
 */
export type AiEnhancedNeed =
  ConfidentEvidenceSupportedAiItem & {
    /**
     * Normalized description of the identified user need.
     */
    readonly need: string;
  };

/**
 * Represents one feature request identified or refined by AI.
 */
export type AiEnhancedFeatureRequest =
  ConfidentEvidenceSupportedAiItem & {
    /**
     * Normalized description of the requested feature.
     */
    readonly feature: string;
  };

/**
 * Represents one software or market opportunity identified by AI.
 */
export type AiEnhancedOpportunity =
  ConfidentEvidenceSupportedAiItem & {
    /**
     * Concise title describing the opportunity.
     */
    readonly title: string;

    /**
     * Explanation of why the opportunity may be valuable.
     *
     * Null is used when no evidence-supported explanation is available.
     */
    readonly description: string | null;
  };

/**
 * Represents one analytical insight produced by AI.
 */
export type AiEnhancedInsight =
  ConfidentEvidenceSupportedAiItem & {
    /**
     * Concise analytical insight.
     */
    readonly insight: string;
  };

/**
 * Structured response expected from one AI-enhancement operation.
 *
 * This contract intentionally excludes:
 * - Analyzed-text counts.
 * - Sentiment statistics.
 * - Keyword and topic frequencies.
 * - Raw evidence text.
 * - Sample posts and comments.
 *
 * Those values are derived from collected data and remain controlled
 * by the rule-based NLP pipeline.
 *
 * This type must remain synchronized with
 * AI_ENHANCEMENT_OUTPUT_SCHEMA.
 */
export type AiEnhancementOutput = {
  /**
   * Recurring problems proposed or semantically refined by AI.
   */
  readonly recurringProblems: readonly AiEnhancedRecurringProblem[];

  /**
   * User needs proposed or semantically refined by AI.
   */
  readonly extractedNeeds: readonly AiEnhancedNeed[];

  /**
   * Feature requests identified or refined by AI.
   */
  readonly featureRequests: readonly AiEnhancedFeatureRequest[];

  /**
   * Software or market opportunities identified by AI.
   */
  readonly opportunities: readonly AiEnhancedOpportunity[];

  /**
   * Additional analytical insights derived from the supplied evidence.
   */
  readonly insights: readonly AiEnhancedInsight[];

  /**
   * Overall confidence score assigned to the AI-enhancement result.
   *
   * The value must be in the inclusive range [0, 1].
   */
  readonly confidence: number;
};