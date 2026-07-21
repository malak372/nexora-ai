import { z } from 'zod';

import {
  AdvancedIdeaFields,
  IdeaSharedFields,
} from './idea-shared-fields.schema';

/**
 * Validates structured output returned for premium credit-based idea
 * generation.
 *
 * Trusted NLP values such as:
 * - Recurring problems.
 * - Extracted needs.
 * - Extracted keywords.
 * - Sample comments.
 * - Analyzed-comment counts.
 * - Confidence values.
 *
 * are intentionally excluded from this schema. They must be loaded
 * directly from the persisted NlpAnalysis record and appended by the
 * business service.
 *
 * This schema must remain synchronized with:
 * - PREMIUM_OUTPUT_SCHEMA
 * - PREMIUM_OUTPUT_FORMAT
 * - The premium-generation prompt template
 *
 * Unknown properties are rejected to prevent unsupported or fabricated
 * fields from entering the application.
 *
 * @author Malak
 */
export const PremiumIdeaSchema = z
  .object({
    /**
     * Generated software-project title.
     */
    title: IdeaSharedFields.title,

    /**
     * Description of the real problem addressed by the project.
     */
    problemStatement: IdeaSharedFields.problemStatement,

    /**
     * Main project goals and expected outcomes.
     */
    objectives: IdeaSharedFields.objectives,

    /**
     * Primary users or organizations expected to use the project.
     */
    targetUsers: IdeaSharedFields.targetUsers,

    /**
     * Complete project abstract.
     */
    fullAbstract: IdeaSharedFields.fullAbstract,

    ...AdvancedIdeaFields,
  })
  .strict();

/**
 * Validated structured output produced by premium credit-based idea
 * generation.
 */
export type PremiumIdeaOutput = z.infer<typeof PremiumIdeaSchema>;
