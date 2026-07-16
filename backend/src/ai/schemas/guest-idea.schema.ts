import { z } from 'zod';

/**
 * Validates structured output returned for guest idea generation.
 *
 * The provider generates the complete free-tier foundation in one
 * request.
 *
 * The public guest response may expose only:
 * - title
 * - limitedAbstract
 *
 * The remaining generated values may be persisted internally so the
 * idea can be transferred to the user after account registration.
 *
 * This schema must remain synchronized with:
 * - GUEST_OUTPUT_SCHEMA
 * - GUEST_OUTPUT_FORMAT
 * - The guest-generation prompt template
 *
 * Unknown properties are rejected.
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
     * Limited abstract exposed to the guest.
     */
    limitedAbstract: z.string().trim().min(20).max(1_200),

    /**
     * Internally persisted problem statement.
     */
    problemStatement: z.string().trim().min(20).max(1_200),

    /**
     * Internally persisted project objectives.
     */
    objectives: z.array(z.string().trim().min(3).max(300)).min(1).max(10),

    /**
     * Internally persisted target users.
     */
    targetUsers: z.array(z.string().trim().min(2).max(200)).min(1).max(10),

    /**
     * Internally persisted partial abstract that becomes available
     * after registration or ownership transfer.
     */
    partialAbstract: z.string().trim().min(30).max(2_500),
  })
  .strict();

/**
 * Validated guest idea output.
 */
export type GuestIdeaOutput = z.infer<typeof GuestIdeaSchema>;
