import { z } from 'zod';

import { IdeaSharedFields } from './idea-shared-fields.schema';

/**
 * Validates structured output returned for guest idea generation.
 *
 * The provider generates the complete free-tier foundation in one
 * request so the idea can later be transferred to a registered user.
 *
 * The public guest response must expose only:
 * - title
 * - limitedAbstract
 *
 * The remaining fields are persisted internally and must not be exposed
 * to the guest before registration or ownership transfer.
 *
 * This schema must remain synchronized with:
 * - GUEST_OUTPUT_SCHEMA
 * - GUEST_OUTPUT_FORMAT
 * - The guest-generation prompt template
 *
 * Unknown properties are rejected to prevent unsupported fields from
 * entering the application.
 *
 * @author Malak
 */
export const GuestIdeaSchema = z
  .object({
    /**
     * Generated software-project title.
     */
    title: IdeaSharedFields.title,

    /**
     * Limited abstract exposed to the unauthenticated guest.
     */
    limitedAbstract: IdeaSharedFields.limitedAbstract,

    /**
     * Internally persisted problem statement.
     */
    problemStatement: IdeaSharedFields.problemStatement,

    /**
     * Internally persisted project objectives.
     */
    objectives: IdeaSharedFields.objectives,

    /**
     * Internally persisted target users.
     */
    targetUsers: IdeaSharedFields.targetUsers,

    /**
     * Internally persisted partial abstract.
     *
     * This value may become available after registration and successful
     * ownership transfer.
     */
    partialAbstract: IdeaSharedFields.partialAbstract,
  })
  .strict();

/**
 * Validated structured output produced by guest idea generation.
 */
export type GuestIdeaOutput = z.infer<typeof GuestIdeaSchema>;
