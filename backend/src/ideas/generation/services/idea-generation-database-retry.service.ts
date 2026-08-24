import { Injectable, Logger } from '@nestjs/common';

import {
  GENERATION_DATABASE_RETRY_BASE_DELAY_MS,
  GENERATION_DATABASE_RETRY_MAX_ATTEMPTS,
  GENERATION_DATABASE_RETRY_MAX_DELAY_MS,
} from '../constants/idea-generation.constants';
import { isTransientDatabaseError } from '../utils/transient-database-error.util';

export type DatabaseRetryOptions = {
  readonly operationName: string;
  readonly runId?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
};

/** Executes critical Prisma operations with bounded exponential backoff. */
@Injectable()
export class IdeaGenerationDatabaseRetryService {
  private readonly logger = new Logger(IdeaGenerationDatabaseRetryService.name);

  async execute<T>(
    operation: () => Promise<T>,
    options: DatabaseRetryOptions,
  ): Promise<T> {
    const maxAttempts = Math.max(
      1,
      options.maxAttempts ?? GENERATION_DATABASE_RETRY_MAX_ATTEMPTS,
    );
    const baseDelayMs = Math.max(
      0,
      options.baseDelayMs ?? GENERATION_DATABASE_RETRY_BASE_DELAY_MS,
    );
    const maxDelayMs = Math.max(
      baseDelayMs,
      options.maxDelayMs ?? GENERATION_DATABASE_RETRY_MAX_DELAY_MS,
    );

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;

        if (!isTransientDatabaseError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const exponentialDelayMs = Math.min(
          baseDelayMs * 2 ** (attempt - 1),
          maxDelayMs,
        );

        // A small jitter prevents several concurrent pipeline queries from
        // retrying against the pooled database at the exact same instant.
        const jitterMs = Math.floor(Math.random() * 180);
        const delayMs = exponentialDelayMs + jitterMs;

        this.logger.warn(
          `Transient database failure during "${options.operationName}"${
            options.runId ? ` for run "${options.runId}"` : ''
          }. Retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms.`,
        );

        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}