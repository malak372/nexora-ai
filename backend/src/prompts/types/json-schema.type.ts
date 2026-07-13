/**
 * Provider-neutral JSON Schema representation.
 *
 * Provider adapters may convert this schema into:
 * - OpenRouter structured outputs.
 * - Groq JSON mode.
 * - Google structured outputs.
 *
 * @author Malak
 */
export type JsonSchema = Readonly<Record<string, unknown>>;
