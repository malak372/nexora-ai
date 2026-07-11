import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';

/**
 * Executes asynchronous AI provider operations with cancellable
 * per-attempt timeouts.
 *
 * This service creates a dedicated AbortController for every provider
 * attempt and aborts the operation when the configured timeout expires.
 *
 * The timeout applies to one external provider attempt only. It does not
 * represent the total duration of retries and fallback execution.
 *
 * @author Malak
 */
@Injectable()
export class AiTimeoutService {
  /**
   * Executes an asynchronous provider operation with a maximum duration.
   *
   * @param operation Provider operation receiving an abort signal.
   * @param timeoutMs Maximum duration in milliseconds.
   * @returns Result produced by the operation.
   *
   * @throws BadRequestException When timeoutMs is invalid.
   * @throws AiProviderError When the configured timeout expires.
   */
  async execute<T>(
    operation: (
      signal: AbortSignal,
    ) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    this.validateTimeout(
      timeoutMs,
    );

    const controller =
      new AbortController();

    let timedOut = false;

    const timeoutHandle =
      setTimeout(() => {
        timedOut = true;

        controller.abort();
      }, timeoutMs);

    try {
      return await operation(
        controller.signal,
      );
    } catch (error: unknown) {
      if (timedOut) {
        throw new AiProviderError(
          `AI request exceeded the configured timeout of ${timeoutMs}ms.`,
          AiProviderErrorCode.TIMEOUT,
          true,
          408,
          undefined,
          error,
        );
      }

      throw error;
    } finally {
      clearTimeout(
        timeoutHandle,
      );
    }
  }

  /**
   * Validates the configured provider-attempt timeout.
   *
   * @param timeoutMs Timeout duration in milliseconds.
   * @throws BadRequestException When the timeout is not a positive
   * finite number.
   */
  private validateTimeout(
    timeoutMs: number,
  ): void {
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new BadRequestException(
        'AI request timeout must be a positive finite number.',
      );
    }
  }
}