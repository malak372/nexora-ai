import { z } from 'zod';

/**
 * Validates structured output returned for premium credit-based
 * idea generation.
 *
 * Trusted NLP values such as:
 * - recurring problems
 * - extracted keywords
 * - sample comments
 * - analyzed comment counts
 * - confidence values
 *
 * are intentionally excluded. They must be loaded directly from
 * NlpAnalysis and appended by the application.
 *
 * This schema must remain synchronized with:
 * - PREMIUM_OUTPUT_SCHEMA
 * - PREMIUM_OUTPUT_FORMAT
 *
 * @author Malak
 */
export const PremiumIdeaSchema = z
  .object({
    /**
     * Generated software-project title.
     */
    title: z.string().trim().min(3).max(200),

    /**
     * Description of the real problem addressed by the project.
     */
    problemStatement: z.string().trim().min(20).max(1_500),

    /**
     * Main project goals and expected outcomes.
     */
    objectives: z
      .array(z.string().trim().min(3).max(300))
      .min(1)
      .max(10),

    /**
     * Primary users or organizations expected to use the project.
     */
    targetUsers: z
      .array(z.string().trim().min(2).max(200))
      .min(1)
      .max(10),

    /**
     * Complete project abstract.
     */
    fullAbstract: z.string().trim().min(50).max(5_000),

    /**
     * Recommended implementation technologies.
     */
    technologyStack: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(12),

    /**
     * High-level system architecture recommendation.
     */
    systemArchitecture: z.string().trim().min(20).max(4_000),

    /**
     * Preliminary database-design recommendation.
     */
    databaseDesign: z.string().trim().min(20).max(4_000),

    /**
     * Minimum viable product features.
     */
    mvpFeatures: z
      .array(z.string().trim().min(3).max(300))
      .min(3)
      .max(15),

    /**
     * Preliminary business-model recommendation.
     */
    businessModel: z.string().trim().min(20).max(2_500),

    /**
     * Suggested revenue streams and monetization strategy.
     */
    revenueModel: z.string().trim().min(20).max(2_000),

    /**
     * Preliminary project budget range and assumptions.
     */
    budgetEstimation: z.string().trim().min(20).max(2_000),

    /**
     * Suggested project implementation timeline.
     */
    implementationTimeline: z.string().trim().min(20).max(2_000),

    /**
     * Technical and operational feasibility assessment.
     */
    feasibilityAssessment: z.string().trim().min(20).max(2_500),

    /**
     * Preliminary assessment of the project's market opportunity.
     */
    marketPotential: z.string().trim().min(20).max(2_500),

    /**
     * High-level local regulatory considerations.
     *
     * This value must not be treated as verified legal advice.
     */
    localRegulations: z.string().trim().min(20).max(2_000),

    /**
     * Explanation of the unique value offered to target users.
     */
    valueProposition: z.string().trim().min(20).max(1_800),

    /**
     * AI-generated readable interpretation of trusted NLP data.
     *
     * This is not the raw persisted NlpAnalysis record.
     */
    nlpExecutiveSummary: z.string().trim().min(20).max(2_500),

    /**
     * AI-generated readable summary of supplied community feedback.
     */
    communityFeedbackSummary: z.string().trim().min(20).max(1_500),
  })
  .strict();

/**
 * Validated premium idea output.
 */
export type PremiumIdeaOutput = z.infer<typeof PremiumIdeaSchema>;