/**
 * Stable registry keys for AI providers implemented by Nexora AI.
 *
 * Provider keys are persisted as strings inside:
 * - AiModel.providerKey
 * - ExternalApiLog.providerKey
 *
 * No Provider database table is required. The backend registry is the
 * source of truth for which providers are implemented and executable.
 *
 * Supporting a new provider requires:
 * 1. Adding its key to AI_PROVIDER_KEYS.
 * 2. Adding its administrator-facing metadata.
 * 3. Implementing the AiProvider interface.
 * 4. Registering the adapter in AiModule.
 * 5. Registering the adapter in AiProviderFactoryService.
 * 6. Adding its server-side credentials.
 *
 * @author Malak
 */
export const AI_PROVIDER_KEYS = {
  GOOGLE: 'google',
  OPENROUTER: 'openrouter',
} as const;

/**
 * Union of every provider key implemented by the current backend.
 */
export type AiProviderKey =
  (typeof AI_PROVIDER_KEYS)[keyof typeof AI_PROVIDER_KEYS];

/**
 * Provider keys accepted by administrator DTOs and runtime services.
 *
 * The explicit tuple preserves literal types and avoids Object.values()
 * being inferred as string[] in stricter or older TypeScript versions.
 */
export const SUPPORTED_AI_PROVIDER_KEYS = [
  AI_PROVIDER_KEYS.GOOGLE,
  AI_PROVIDER_KEYS.OPENROUTER,
] as const satisfies readonly AiProviderKey[];

/**
 * Administrator-facing metadata for providers implemented by the
 * backend.
 *
 * This metadata may be returned to the administrator dashboard so the
 * UI displays only providers with registered backend adapters.
 *
 * API keys and other secrets must never be included here.
 */
export const SUPPORTED_AI_PROVIDERS = [
  {
    key: AI_PROVIDER_KEYS.GOOGLE,
    displayName: 'Google AI',
    description: 'Google Gemini models accessed through the Google AI API.',
  },
  {
    key: AI_PROVIDER_KEYS.OPENROUTER,
    displayName: 'OpenRouter',
    description: 'AI models accessed through the OpenRouter unified API.',
  },
] as const satisfies readonly {
  readonly key: AiProviderKey;
  readonly displayName: string;
  readonly description: string;
}[];

/**
 * One provider entry returned to administrator-facing endpoints.
 */
export type SupportedAiProvider = (typeof SUPPORTED_AI_PROVIDERS)[number];

/**
 * Checks whether a normalized string is a provider key implemented by
 * the current backend.
 *
 * @param value Normalized provider-key candidate.
 * @returns True when the value is a supported provider key.
 */
export function isAiProviderKey(value: string): value is AiProviderKey {
  return SUPPORTED_AI_PROVIDER_KEYS.some(
    (providerKey) => providerKey === value,
  );
}

/**
 * Normalizes and validates a provider key.
 *
 * Database values and administrator input may contain uppercase
 * characters or surrounding spaces. This function centralizes their
 * normalization and safely narrows valid values to AiProviderKey.
 *
 * @param value Raw provider key.
 * @returns Supported normalized key, or undefined when unsupported.
 */
export function normalizeAiProviderKey(
  value: string,
): AiProviderKey | undefined {
  const normalizedValue = value.trim().toLowerCase();

  return isAiProviderKey(normalizedValue) ? normalizedValue : undefined;
}
