
/**
 * Provider-neutral JSON Schema representation.
 *
 * PromptBuilderService produces this generic schema without
 * depending on one specific AI provider.
 *
 * Provider adapters may transform it into:
 * - OpenRouter structured-output configuration.
 * - Google response-schema configuration.
 *
 * Keeping this type provider-neutral allows AI providers to be
 * replaced or extended without changing the prompt-building domain.
 *
 * @author Malak
 */
export type JsonSchema =
  Readonly<Record<string, unknown>>;

