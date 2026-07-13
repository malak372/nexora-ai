import { AiProviderType, ApiProvider } from '@prisma/client';

/**
 * Environment-variable names associated with supported AI providers.
 *
 * Provider credentials must remain outside the database.
 *
 * @author Malak
 */
export const AI_PROVIDER_API_KEY_ENVIRONMENT_KEYS = {
  [AiProviderType.GOOGLE]: 'GOOGLE_AI_API_KEY',
  [AiProviderType.GROQ]: 'GROQ_API_KEY',
  [AiProviderType.OPENROUTER]: 'OPENROUTER_API_KEY',
} as const satisfies Record<AiProviderType, string>;

/**
 * Maps AI model providers into ExternalApiLog providers.
 *
 * @author Malak
 */
export const AI_PROVIDER_TO_API_PROVIDER = {
  [AiProviderType.GOOGLE]: ApiProvider.GOOGLE,
  [AiProviderType.GROQ]: ApiProvider.GROQ,
  [AiProviderType.OPENROUTER]: ApiProvider.OPENROUTER,
} as const satisfies Record<AiProviderType, ApiProvider>;

export const AI_TEXT_GENERATION_ENDPOINT = 'text-generation';

export const RETRYABLE_AI_PROVIDER_STATUS_CODES = new Set<number>([
  408, 409, 425, 429, 500, 502, 503, 504, 529,
]);

export const NON_RETRYABLE_AI_PROVIDER_STATUS_CODES = new Set<number>([
  400, 401, 402, 403, 404, 405, 422,
]);

export function isRetryableAiProviderStatus(statusCode?: number): boolean {
  if (statusCode === undefined) {
    return false;
  }

  if (NON_RETRYABLE_AI_PROVIDER_STATUS_CODES.has(statusCode)) {
    return false;
  }

  return (
    RETRYABLE_AI_PROVIDER_STATUS_CODES.has(statusCode) || statusCode >= 500
  );
}
