import {
  AiProviderType,
  ApiProvider,
} from '@prisma/client';

/**
 * Environment-variable names associated with supported AI providers.
 *
 * Provider credentials must remain outside the database and must
 * never be included in logs, API responses, or persisted metadata.
 *
 * Using satisfies Record ensures that adding a new AiProviderType
 * requires adding its environment-variable mapping at compile time.
 *
 * @author Malak
 */
export const AI_PROVIDER_API_KEY_ENVIRONMENT_KEYS = {
  [AiProviderType.OPENAI]: 'OPENAI_API_KEY',

  [AiProviderType.ANTHROPIC]: 'ANTHROPIC_API_KEY',

  [AiProviderType.GOOGLE]: 'GOOGLE_AI_API_KEY',

  [AiProviderType.GROQ]: 'GROQ_API_KEY',
} as const satisfies Record<
  AiProviderType,
  string
>;

/**
 * Maps the AI-model provider enum to the broader provider enum used
 * by ExternalApiLog.
 *
 * Using a compile-time complete Record prevents a newly added AI
 * provider from being omitted accidentally.
 *
 * @author Malak
 */
export const AI_PROVIDER_TO_API_PROVIDER = {
  [AiProviderType.OPENAI]: ApiProvider.OPENAI,

  [AiProviderType.ANTHROPIC]: ApiProvider.ANTHROPIC,

  [AiProviderType.GOOGLE]: ApiProvider.GOOGLE,

  [AiProviderType.GROQ]: ApiProvider.GROQ,
} as const satisfies Record<
  AiProviderType,
  ApiProvider
>;

/**
 * Standard internal endpoint label stored for text-generation calls.
 *
 * This is an application operation name rather than an external
 * provider URL.
 */
export const AI_TEXT_GENERATION_ENDPOINT =
  'text-generation';

/**
 * Provider HTTP status codes that normally represent temporary
 * failures.
 */
export const RETRYABLE_AI_PROVIDER_STATUS_CODES =
  new Set<number>([
    408,
    409,
    425,
    429,
    500,
    502,
    503,
    504,
    529,
  ]);

/**
 * Provider HTTP status codes that normally represent permanent
 * request, authentication, permission, or model-selection failures.
 */
export const NON_RETRYABLE_AI_PROVIDER_STATUS_CODES =
  new Set<number>([
    400,
    401,
    403,
    404,
    405,
    422,
  ]);

/**
 * Determines whether an HTTP status normally permits another attempt
 * using the same model.
 *
 * @param statusCode Optional provider HTTP status code.
 * @returns True when the status normally represents a temporary error.
 */
export function isRetryableAiProviderStatus(
  statusCode?: number,
): boolean {
  if (statusCode === undefined) {
    return false;
  }

  if (
    NON_RETRYABLE_AI_PROVIDER_STATUS_CODES.has(
      statusCode,
    )
  ) {
    return false;
  }

  return (
    RETRYABLE_AI_PROVIDER_STATUS_CODES.has(
      statusCode,
    ) ||
    statusCode >= 500
  );
}