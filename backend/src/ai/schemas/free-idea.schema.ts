import { z } from 'zod';

import { IdeaSharedFields } from './idea-shared-fields.schema';

/**
 * Validates structured output returned for authenticated free idea
 * generation.
 *
 * This schema must remain synchronized with:
 * - FREE_OUTPUT_SCHEMA
 * - FREE_OUTPUT_FORMAT
 * - The authenticated free-generation prompt template
 *
 * Unknown properties are rejected to prevent AI providers from
 * returning unexpected or unsupported fields.
 *
 * @author Malak
 */
export const FreeIdeaSchema = z
  .object({
    /**
     * Generated software-project title.
     */
    title: IdeaSharedFields.title,

    /**
     * Description of the problem addressed by the project.
     */
    problemStatement: IdeaSharedFields.problemStatement,

    /**
     * Main project objectives.
     */
    objectives: IdeaSharedFields.objectives,

    /**
     * Primary users or organizations targeted by the project.
     */
    targetUsers: IdeaSharedFields.targetUsers,

    /**
     * Partial project abstract available to authenticated free users.
     */
    partialAbstract: IdeaSharedFields.partialAbstract,
  })
  .strict();

/**
 * Validated structured output produced by authenticated free idea
 * generation.
 */
export type FreeIdeaOutput = z.infer<typeof FreeIdeaSchema>;