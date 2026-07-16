import { AiProviderErrorCode } from './ai-provider-error-code.enum';

/**
 * Normalized error thrown by AI provider adapters.
 *
 * This error isolates the application from provider-specific SDK
 * exceptions by exposing a consistent structure that can be handled by:
 * - AiExecutionService.
 * - Retry policy.
 * - Fallback policy.
 * - External API logging.
 *
 * Provider adapters should wrap SDK-specific exceptions inside this
 * class before propagating them to higher application layers.
 *
 * @author Malak
 */
export class AiProviderError extends Error {
  /**
   * Creates a normalized AI provider error.
   *
   * @param message Safe human-readable error message.
   * @param code Provider-independent error category.
   * @param retryable Whether the same model may be attempted again.
   * @param statusCode Optional HTTP status code returned by the provider.
   * @param requestId Optional provider request identifier.
   * @param cause Original provider SDK error used only internally.
   */
  constructor(
    message: string,

    /**
     * Provider-independent error category.
     */
    public readonly code: AiProviderErrorCode,

    /**
     * Indicates whether another attempt may be performed using the
     * same model.
     *
     * Fallback eligibility is decided separately by
     * AiExecutionService.
     */
    public readonly retryable: boolean,

    /**
     * Optional provider HTTP status code.
     */
    public readonly statusCode?: number,

    /**
     * Optional provider request identifier.
     */
    public readonly requestId?: string,

    /**
     * Original provider SDK error.
     *
     * This value is internal only and must never be returned directly
     * to API clients.
     */
    public readonly cause?: unknown,
  ) {
    super(message);

    this.name = AiProviderError.name;

    /**
     * Restores the prototype chain when extending Error.
     */
    Object.setPrototypeOf(this, new.target.prototype);

    /**
     * Produces a cleaner stack trace in Node.js V8 environments.
     */
    Error.captureStackTrace?.(this, AiProviderError);
  }
}
