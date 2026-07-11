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
 * Represents one recurring problem proposed or refined by AI.
 */
export type AiEnhancedRecurringProblem = {
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

  /**
   * Identifiers of existing evidence samples supporting the problem.
   */
  readonly supportingEvidenceIds: ReadonlyArray<string>;
};

/**
 * Represents one user need identified or refined by AI.
 */
export type AiEnhancedNeed = {
  /**
   * Normalized description of the identified user need.
   */
  readonly need: string;

  /**
   * Confidence score in the inclusive range [0, 1].
   */
  readonly confidence: number;

  /**
   * Identifiers of existing evidence samples supporting the need.
   */
  readonly supportingEvidenceIds: ReadonlyArray<string>;
};

/**
 * Represents one feature request identified or refined by AI.
 */
export type AiEnhancedFeatureRequest = {
  /**
   * Normalized description of the requested feature.
   */
  readonly feature: string;

  /**
   * Confidence score in the inclusive range [0, 1].
   */
  readonly confidence: number;

  /**
   * Identifiers of existing evidence samples supporting the request.
   */
  readonly supportingEvidenceIds: ReadonlyArray<string>;
};

/**
 * Represents one software or market opportunity identified by AI.
 */
export type AiEnhancedOpportunity = {
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

  /**
   * Confidence score in the inclusive range [0, 1].
   */
  readonly confidence: number;

  /**
   * Identifiers of existing evidence samples supporting the opportunity.
   */
  readonly supportingEvidenceIds: ReadonlyArray<string>;
};

/**
 * Represents one analytical insight produced by AI.
 */
export type AiEnhancedInsight = {
  /**
   * Concise analytical insight.
   */
  readonly insight: string;

  /**
   * Confidence score in the inclusive range [0, 1].
   */
  readonly confidence: number;

  /**
   * Identifiers of existing evidence samples supporting the insight.
   */
  readonly supportingEvidenceIds: ReadonlyArray<string>;
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
 */
export type AiEnhancementOutput = {
  /**
   * Recurring problems proposed or semantically refined by AI.
   */
  readonly recurringProblems: ReadonlyArray<AiEnhancedRecurringProblem>;

  /**
   * User needs proposed or semantically refined by AI.
   */
  readonly extractedNeeds: ReadonlyArray<AiEnhancedNeed>;

  /**
   * Feature requests identified or refined by AI.
   */
  readonly featureRequests: ReadonlyArray<AiEnhancedFeatureRequest>;

  /**
   * Software or market opportunities identified by AI.
   */
  readonly opportunities: ReadonlyArray<AiEnhancedOpportunity>;

  /**
   * Additional analytical insights derived from the supplied evidence.
   */
  readonly insights: ReadonlyArray<AiEnhancedInsight>;

  /**
   * Overall confidence score assigned to the AI-enhancement result.
   *
   * The value must be in the inclusive range [0, 1].
   */
  readonly confidence: number;
};
