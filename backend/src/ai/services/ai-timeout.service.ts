import { BadRequestException, Injectable } from '@nestjs/common';

import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';

/**
 * Executes asynchronous AI-provider operations with cancellable
 * per-attempt timeouts.
 *
 * Every execution creates a dedicated AbortController. When the timeout
 * expires, the service:
 *
 * - Aborts the provider operation through AbortSignal.
 * - Rejects the current attempt immediately with AiProviderError.
 *
 * Promise.race() is intentionally used because AbortSignal alone cannot
 * guarantee that an operation stops. Some SDKs or provider adapters may
 * ignore cancellation signals or complete their internal work later.
 *
 * The configured timeout applies to one external provider attempt only.
 * It does not represent the total duration of:
 *
 * - Retries.
 * - Retry backoff delays.
 * - Provider fallback.
 * - Structured-output repair attempts.
 *
 * @author Malak
 */
@Injectable()
export class AiTimeoutService {
  /**
   * Executes one asynchronous AI-provider operation within a maximum
   * duration.
   *
   * A dedicated AbortSignal is passed to the operation. When the timeout
   * expires, the signal is aborted and the timeout promise rejects.
   *
   * @template T Result type returned by the provider operation.
   * @param operation Provider operation receiving a cancellation signal.
   * @param timeoutMs Maximum duration of this provider attempt in
   * milliseconds.
   * @returns Result produced before the timeout expires.
   *
   * @throws BadRequestException when operation is not callable or
   * timeoutMs is not a positive finite number.
   * @throws AiProviderError when the configured timeout expires.
   * @throws unknown when the provider operation fails before timeout.
   */
  async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    this.validateOperation(operation);
    this.validateTimeout(timeoutMs);

    const controller = new AbortController();

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const operationPromise = Promise.resolve().then(() =>
      operation(controller.signal),
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();

        reject(this.createTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Creates the normalized provider error returned when one execution
   * attempt exceeds its configured timeout.
   *
   * The timeout is considered retryable because another attempt or
   * fallback provider may complete successfully.
   *
   * @param timeoutMs Configured timeout duration in milliseconds.
   * @returns Retryable AI-provider timeout error.
   */
  private createTimeoutError(timeoutMs: number): AiProviderError {
    return new AiProviderError(
      `AI request exceeded the configured timeout of ${timeoutMs}ms.`,
      AiProviderErrorCode.TIMEOUT,
      true,
      408,
    );
  }

  /**
   * Validates the provider operation supplied to execute().
   *
   * This runtime check protects JavaScript callers and unsafe casts,
   * even though TypeScript already requires a function at compile time.
   *
   * @param operation Candidate provider operation.
   * @throws BadRequestException when the supplied value is not callable.
   */
  private validateOperation<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): void {
    if (typeof operation !== 'function') {
      throw new BadRequestException(
        'AI provider operation must be a function.',
      );
    }
  }

  /**
   * Validates the configured timeout for one provider attempt.
   *
   * The timeout must be:
   *
   * - A number.
   * - Finite.
   * - Greater than zero.
   * - A safe integer.
   *
   * Requiring an integer avoids ambiguous fractional timer values.
   *
   * @param timeoutMs Timeout duration in milliseconds.
   * @throws BadRequestException when the timeout value is invalid.
   */
  private validateTimeout(timeoutMs: number): void {
    if (
      !Number.isFinite(timeoutMs) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new BadRequestException(
        'AI request timeout must be a positive safe integer.',
      );
    }
  }
}
