/**
 * Public exports for provider-neutral AI output formats.
 *
 * Business modules should import prompt output schemas and human-readable
 * output examples through this barrel file where practical.
 *
 * @author Malak
 */

export * from './idea-shared-output-fields';

export { FREE_OUTPUT_FORMAT, FREE_OUTPUT_SCHEMA } from './free-output-format';

export {
  GUEST_OUTPUT_FORMAT,
  GUEST_OUTPUT_SCHEMA,
} from './guest-output-format';

export {
  PREMIUM_OUTPUT_FORMAT,
  PREMIUM_OUTPUT_SCHEMA,
} from './premium-output-format';

export {
  UNLOCK_OUTPUT_FORMAT,
  UNLOCK_OUTPUT_SCHEMA,
} from './unlock-output-format';
