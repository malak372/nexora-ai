import { z } from 'zod';

import {
  AdvancedIdeaFields,
  IdeaSharedFields,
} from './idea-shared-fields.schema';

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
 * Trusted NLP values are also excluded and must be loaded directly from
 * the persisted NlpAnalysis record.
 *
 * The AI provider generates only the advanced fields required to upgrade
 * the existing idea.
 *
 * This schema must remain synchronized with:
 * - UNLOCK_OUTPUT_SCHEMA
 * - UNLOCK_OUTPUT_FORMAT
 * - The idea-unlock prompt template
 *
 * Unknown properties are rejected to ensure that the provider cannot
 * overwrite existing basic idea data.
 *
 * @author Malak
 */
export const UnlockIdeaSchema = z
  .object({
    /**
     * Complete abstract expanding the existing free idea.
     */
    fullAbstract: IdeaSharedFields.fullAbstract,

    ...AdvancedIdeaFields,
  })
  .strict();

/**
 * Validated structured output produced when unlocking an existing idea.
 */
export type UnlockIdeaOutput = z.infer<typeof UnlockIdeaSchema>;
