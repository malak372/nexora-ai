/**
 * Provider-neutral JSON Schema accepted by the central AI runtime.
 *
 * The schema may originate from:
 * - PromptModule for idea generation.
 * - NlpModule for AI-assisted NLP enhancement.
 * - Chat or abstract-generation modules in the future.
 *
 * The AI execution layer treats the schema as an immutable
 * provider-neutral contract.
 *
 * Provider adapters may optionally translate this contract into:
 *
 * - OpenRouter structured-output configuration.
 * - Groq JSON response configuration.
 * - Google structured-output configuration.
 *
 * Runtime validation remains centralized inside
 * AiStructuredOutputService regardless of provider support.
 *
 * @author Malak
 */
export type AiJsonSchema = Readonly<Record<string, unknown>>;
