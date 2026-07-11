import { z } from 'zod';

/**
 * Validates structured output returned for guest idea generation.
 *
 * This schema must remain synchronized with:
 * - GUEST_OUTPUT_SCHEMA
 * - GUEST_OUTPUT_FORMAT
 *
 * Unknown fields are rejected to prevent providers from returning
 * unexpected or unsupported data.
 *
 * @author Malak
 */
export const GuestIdeaSchema = z
  .object({
    /**
     * Generated software-project title.
     */
    title: z.string().trim().min(3).max(200),

    /**
     * Limited project abstract available to guest users.
     */
    limitedAbstract: z.string().trim().min(20).max(1_200),
  })
  .strict();

/**
 * Validated guest idea output.
 */
export type GuestIdeaOutput = z.infer<typeof GuestIdeaSchema>;
