/**
 * Provider-independent categories for AI execution failures.
 *
 * Provider adapters must translate SDK-specific errors into one of
 * these values before propagating the error to AiExecutionService.
 *
 * The error code is used to decide:
 * - Whether the same model may be retried.
 * - Whether execution may fall back to another model.
 * - Whether the complete logical operation must stop.
 *
 * @author Malak
 */
export enum AiProviderErrorCode {
  /**
   * The provider request exceeded the configured execution timeout.
   */
  TIMEOUT = 'TIMEOUT',

  /**
   * A temporary network, DNS, connection, or transport failure.
   */
  NETWORK = 'NETWORK',

  /**
   * The provider temporarily rejected the request because of
   * rate limiting.
   */
  RATE_LIMIT = 'RATE_LIMIT',

  /**
   * The provider account, organization, or project does not have
   * enough available quota or credit to execute the request.
   */
  INSUFFICIENT_QUOTA = 'INSUFFICIENT_QUOTA',

  /**
   * The provider is temporarily unavailable or overloaded.
   */
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',

  /**
   * Provider credentials are missing, expired, or invalid.
   */
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  /**
   * The configured credentials do not have permission to execute
   * the requested operation.
   */
  FORBIDDEN = 'FORBIDDEN',

  /**
   * The requested provider model does not exist or is unavailable
   * for the configured account.
   */
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',

  /**
   * The configured provider model or one of its parameters is not
   * supported.
   */
  INVALID_MODEL_CONFIGURATION = 'INVALID_MODEL_CONFIGURATION',

  /**
   * The generated provider response did not contain usable text.
   */
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',

  /**
   * The provider returned JSON or structured output that did not
   * match the expected application schema.
   */
  INVALID_STRUCTURED_OUTPUT = 'INVALID_STRUCTURED_OUTPUT',

  /**
   * The request prompt or its provider-specific representation was
   * invalid.
   */
  INVALID_PROMPT = 'INVALID_PROMPT',

  /**
   * The provider blocked the response because of safety or content
   * policies.
   */
  CONTENT_FILTERED = 'CONTENT_FILTERED',

  /**
   * The request was cancelled intentionally.
   */
  CANCELLED = 'CANCELLED',

  /**
   * An unexpected provider or SDK error could not be classified
   * more precisely.
   */
  UNKNOWN = 'UNKNOWN',
}
