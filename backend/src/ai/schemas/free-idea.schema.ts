import { z } from 'zod';

/**
 * Validates structured output returned for registered free generation.
 *
 * This schema must remain synchronized with:
 * - FREE_OUTPUT_SCHEMA
 * - FREE_OUTPUT_FORMAT
 *
 * Unknown fields are rejected to prevent providers from returning
 * unexpected or unsupported data.
 *
 * @author Malak
 */
export const FreeIdeaSchema = z
  .object({
    /**
     * Generated software-project title.
     */
    title: z.string().trim().min(3).max(200),

    /**
     * Description of the problem addressed by the project.
     */
    problemStatement: z.string().trim().min(20).max(1_200),

    /**
     * Main project objectives.
     */
    objectives: z.array(z.string().trim().min(3).max(300)).min(1).max(10),

    /**
     * Primary users or organizations targeted by the project.
     */
    targetUsers: z.array(z.string().trim().min(2).max(200)).min(1).max(10),

    /**
     * Partial project abstract available to registered free users.
     */
    partialAbstract: z.string().trim().min(30).max(2_500),
  })
  .strict();

/**
 * Validated registered free idea output.
 */
export type FreeIdeaOutput = z.infer<typeof FreeIdeaSchema>;
