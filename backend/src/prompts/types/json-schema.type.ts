/**
 * Provider-neutral JSON Schema representation.
 *
 * Provider adapters may convert this schema into:
 * - OpenAI Structured Outputs.
 * - Google Gemini responseSchema.
 * - Anthropic tool-input schema.
 *
 * @author Malak
 */
export type JsonSchema = Readonly<Record<string, unknown>>;
