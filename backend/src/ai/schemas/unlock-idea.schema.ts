import { z } from 'zod';

/**
 * Validates structured output returned when unlocking an existing
 * authenticated free idea.
 *
 * Existing basic idea fields are intentionally excluded because they
 * must remain unchanged:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - partialAbstract
 *
 * Trusted NLP data is also excluded and must be loaded directly from
 * NlpAnalysis.
 *
 * This schema must remain synchronized with:
 * - UNLOCK_OUTPUT_SCHEMA
 * - UNLOCK_OUTPUT_FORMAT
 * - The idea-unlock prompt template
 *
 * Unknown properties are rejected.
 *
 * @author Malak
 */
export const UnlockIdeaSchema = z
  .object({
    /**
     * Complete abstract expanding the existing idea.
     */
    fullAbstract: z.string().trim().min(50).max(5_000),

    /**
     * Recommended implementation technologies.
     */
    technologyStack: z.array(z.string().trim().min(1).max(100)).min(1).max(12),

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
    mvpFeatures: z.array(z.string().trim().min(3).max(300)).min(3).max(15),

    /**
     * Preliminary business-model recommendation.
     */
    businessModel: z.string().trim().min(20).max(2_500),

    /**
     * Suggested revenue streams and monetization strategy.
     */
    revenueModel: z.string().trim().min(20).max(2_000),

    /**
     * Preliminary budget range and relevant assumptions.
     */
    budgetEstimation: z.string().trim().min(20).max(2_000),

    /**
     * Suggested implementation timeline.
     */
    implementationTimeline: z.string().trim().min(20).max(2_000),

    /**
     * Technical and operational feasibility assessment.
     */
    feasibilityAssessment: z.string().trim().min(20).max(2_500),

    /**
     * Preliminary assessment of market opportunity.
     */
    marketPotential: z.string().trim().min(20).max(2_500),

    /**
     * High-level local regulatory considerations.
     *
     * This value must not be presented as verified legal advice.
     */
    localRegulations: z.string().trim().min(20).max(2_000),

    /**
     * Explanation of the value offered to target users.
     */
    valueProposition: z.string().trim().min(20).max(1_800),

    /**
     * AI-generated readable interpretation of trusted NLP data.
     */
    nlpExecutiveSummary: z.string().trim().min(20).max(2_500),

    /**
     * AI-generated readable summary of supplied community feedback.
     */
    communityFeedbackSummary: z.string().trim().min(20).max(1_500),
  })
  .strict();

/**
 * Validated idea-unlock output.
 */
export type UnlockIdeaOutput = z.infer<typeof UnlockIdeaSchema>;
