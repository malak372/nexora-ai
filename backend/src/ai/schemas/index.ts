/**
 * Public exports for structured AI-response schemas.
 *
 * Business services should import schemas and inferred output types
 * through this barrel file where practical.
 *
 * @author Malak
 */

export * from './idea-shared-fields.schema';

export { FreeIdeaSchema, type FreeIdeaOutput } from './free-idea.schema';

export { GuestIdeaSchema, type GuestIdeaOutput } from './guest-idea.schema';

export {
  PremiumIdeaSchema,
  type PremiumIdeaOutput,
} from './premium-idea.schema';

export {
  UnlockIdeaSchema,
  type UnlockIdeaOutput,
} from './unlock-idea.schema';