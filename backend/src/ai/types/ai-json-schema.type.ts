/**
 * Provider-neutral JSON Schema accepted by the central AI runtime.
 *
 * The schema may originate from:
 * - PromptModule for idea generation.
 * - NlpModule for AI-assisted NLP enhancement.
 * - Chat or abstract-generation modules.
 * - Future structured AI workflows.
 *
 * Provider adapters may optionally translate this schema into native
 * provider structured-output configuration.
 *
 * Runtime AJV validation remains mandatory regardless of native
 * provider support.
 *
 * @author Malak
 */
export type AiJsonSchema = Readonly<Record<string, unknown>>;
