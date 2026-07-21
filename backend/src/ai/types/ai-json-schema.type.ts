/**
 * Provider-neutral JSON Schema consumed by the central AI runtime.
 *
 * This schema describes the expected structured response independently
 * of any provider-specific SDK or API.
 *
 * The schema may originate from:
 * - PromptModule for idea generation.
 * - NlpModule for AI-assisted NLP enhancement.
 * - Chat or abstract-generation modules.
 * - Future structured AI workflows.
 *
 * Provider adapters may optionally translate this schema into native
 * provider structured-output configuration when supported.
 *
 * Regardless of native provider capabilities, every structured response
 * must still pass centralized parsing and AJV validation before it is
 * accepted by the application.
 *
 * The runtime treats this value as immutable.
 *
 * @author Malak
 */
export type AiJsonSchema = Readonly<Record<string, unknown>>;
