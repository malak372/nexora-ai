import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Represents an asynchronous task executed by the collector queue.
 *
 * @template T Task return type.
 */
type QueueTask<T> = (signal?: AbortSignal) => Promise<T>;

/**
 * Metadata used for logging and monitoring queued collector tasks.
 */
type QueueTaskMetadata = {
  /**
   * Optional platform name associated with the queued task.
   *
   * Prisma enum values such as CollectionSourceType are assignable
   * to string, so a separate enum union is not required here.
   */
  platform?: string;

  /** Optional hard task budget used by fast idea generation. */
  timeoutMs?: number;

  /** Optional parent cancellation signal propagated from the generation run. */
  signal?: AbortSignal;

  /**
   * Small post-timeout grace window. After the hard budget is crossed the
   * collector receives AbortSignal, but a cooperative collector may still
   * return already-discovered partial results during this window. Those results
   * are harvested instead of being discarded.
   */
  timeoutGraceMs?: number;

  /**
   * When false, timeoutMs is a soft observability budget only. The queue logs
   * the overrun but never aborts/rejects a healthy collector task. This is used
   * by idea-generation collection so an app/news source that already found
   * useful data is not discarded just because a review/detail fetch crossed a
   * short wall-clock target. Collector-local HTTP/request guards remain the
   * bounded failure protection.
   */
  abortOnTimeout?: boolean;
};

/**
 * Represents the current state of the collector queue.
 */
type CollectorQueueStatus = {
  /**
   * Number of tasks currently running.
   */
  running: number;

  /**
   * Number of tasks waiting in the queue.
   */
  waiting: number;

  /**
   * Maximum number of concurrently running tasks.
   */
  concurrency: number;

  /**
   * Maximum number of tasks allowed to wait.
   */
  maxQueueSize: number;
};

/**
 * Service responsible for limiting concurrent execution of
 * data collection tasks.
 *
 * Features:
 * - Configurable concurrency.
 * - A default parallel capacity large enough for all registered collectors.
 * - Configurable maximum waiting queue size.
 * - FIFO task scheduling.
 * - Optional platform-aware logging.
 * - Queue status monitoring.
 *
 * Environment variables:
 * - COLLECTOR_QUEUE_CONCURRENCY
 * - COLLECTOR_QUEUE_MAX_SIZE
 *
 * @author Malak
 */
@Injectable()
export class CollectorQueueService {
  private readonly logger = new Logger(CollectorQueueService.name);

  /**
   * Number of tasks currently running.
   */
  private running = 0;

  /**
   * Waiting tasks queue.
   */
  private readonly queue: Array<() => void> = [];

  /**
   * Maximum number of tasks allowed to run at the same time.
   */
  private readonly concurrency: number;

  /**
   * Maximum number of tasks allowed to wait in the queue.
   */
  private readonly maxQueueSize: number;

  constructor(private readonly configService: ConfigService) {
    const configuredConcurrency = this.getPositiveNumber(
      'COLLECTOR_QUEUE_CONCURRENCY',
      16,
    );

    this.concurrency = Math.min(32, Math.max(16, configuredConcurrency));

    this.maxQueueSize = this.getPositiveNumber('COLLECTOR_QUEUE_MAX_SIZE', 100);
  }

  /**
   * Executes a task using the collector queue.
   *
   * If the concurrency limit is reached, the task waits.
   * If the waiting queue is full, the task is rejected safely.
   *
   * @param task Async task to execute.
   * @param metadata Optional task metadata used for logging.
   * @returns The result returned by the executed task.
   */
  async run<T>(
    task: QueueTask<T>,
    metadata?: QueueTaskMetadata | string,
  ): Promise<T> {
    const platform = this.resolvePlatform(metadata);
    const timeoutMs = typeof metadata === 'object' ? metadata.timeoutMs : undefined;
    const parentSignal = typeof metadata === 'object' ? metadata.signal : undefined;
    const timeoutGraceMs =
      typeof metadata === 'object' && Number.isFinite(metadata.timeoutGraceMs)
        ? Math.max(0, Number(metadata.timeoutGraceMs))
        : 0;
    const abortOnTimeout =
      typeof metadata === 'object' ? metadata.abortOnTimeout !== false : true;

    if (this.running >= this.concurrency) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new ServiceUnavailableException(
          'Collector queue is full. Please try again later.',
        );
      }

      this.logger.debug(
        `Collector task queued${platform ? ` for ${platform}` : ''}. Waiting: ${this.queue.length + 1}`,
      );

      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.running += 1;

    try {
      this.logger.log(
        `Collector task started${platform ? ` for ${platform}` : ''}. Running: ${this.running}`,
      );

      const controller = new AbortController();
      type TimedResult =
        | { readonly kind: 'RESULT'; readonly value: T }
        | { readonly kind: 'ERROR'; readonly error: unknown }
        | { readonly kind: 'TIMEOUT' }
        | { readonly kind: 'PARENT_ABORT' };

      let resolveParentAbort: ((value: TimedResult) => void) | null = null;
      const parentAbortResult = new Promise<TimedResult>((resolve) => {
        resolveParentAbort = resolve;
      });
      const abortFromParent = () => {
        if (!controller.signal.aborted) {
          controller.abort(parentSignal?.reason);
        }
        resolveParentAbort?.({ kind: 'PARENT_ABORT' });
      };

      if (parentSignal?.aborted) {
        abortFromParent();
      } else {
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
      }

      if (parentSignal?.aborted) {
        throw new ServiceUnavailableException(
          `Collector task${platform ? ` for ${platform}` : ''} was cancelled by the parent generation deadline.`,
        );
      }

      const taskPromise = task(controller.signal);
      const wrappedTask = taskPromise.then<TimedResult, TimedResult>(
        (value) => ({ kind: 'RESULT', value }),
        (error: unknown) => ({ kind: 'ERROR', error }),
      );
      const raceBase = parentSignal
        ? [wrappedTask, parentAbortResult]
        : [wrappedTask];
      let timeoutHandle: NodeJS.Timeout | null = null;

      const unwrap = (result: TimedResult): T => {
        if (result.kind === 'RESULT') return result.value;
        if (result.kind === 'ERROR') throw result.error;
        if (result.kind === 'PARENT_ABORT') {
          throw new ServiceUnavailableException(
            `Collector task${platform ? ` for ${platform}` : ''} was cancelled by the parent generation deadline.`,
          );
        }
        throw new ServiceUnavailableException(
          `Collector task${platform ? ` for ${platform}` : ''} exceeded ${timeoutMs ?? 0}ms.`,
        );
      };

      try {
        if (!timeoutMs || timeoutMs <= 0) {
          return unwrap(await Promise.race<TimedResult>(raceBase));
        }

        /*
         * A soft source timeout remains telemetry only. Parent cancellation is
         * different: it is the generation/recovery hard wall-clock contract,
         * so the queue returns immediately even if a third-party parser ignores
         * AbortSignal after the underlying HTTP request has already been cut.
         */
        if (!abortOnTimeout) {
          timeoutHandle = setTimeout(() => {
            this.logger.warn(
              `Collector task${platform ? ` for ${platform}` : ''} crossed soft ${timeoutMs}ms budget; allowing it to finish unless the parent generation deadline is reached.`,
            );
          }, timeoutMs);
          timeoutHandle.unref?.();
          return unwrap(await Promise.race<TimedResult>(raceBase));
        }

        const timeoutResult = new Promise<TimedResult>((resolve) => {
          timeoutHandle = setTimeout(() => resolve({ kind: 'TIMEOUT' }), timeoutMs);
          timeoutHandle.unref?.();
        });
        const first = await Promise.race<TimedResult>([
          ...raceBase,
          timeoutResult,
        ]);

        if (first.kind !== 'TIMEOUT') return unwrap(first);

        const timeoutError = new Error(
          `Collector task${platform ? ` for ${platform}` : ''} exceeded ${timeoutMs}ms.`,
        );
        if (!controller.signal.aborted) controller.abort(timeoutError);

        if (timeoutGraceMs > 0 && !parentSignal?.aborted) {
          const graceResult = new Promise<TimedResult>((resolve) => {
            const handle = setTimeout(
              () => resolve({ kind: 'TIMEOUT' }),
              timeoutGraceMs,
            );
            handle.unref?.();
          });
          const grace = await Promise.race<TimedResult>([
            ...raceBase,
            graceResult,
          ]);
          if (grace.kind === 'RESULT') {
            this.logger.warn(
              `Collector task${platform ? ` for ${platform}` : ''} crossed ${timeoutMs}ms but returned harvestable partial/complete data inside ${timeoutGraceMs}ms grace; preserving the result.`,
            );
            return grace.value;
          }
          if (grace.kind === 'ERROR' && !controller.signal.aborted) {
            throw grace.error;
          }
          if (grace.kind === 'PARENT_ABORT') return unwrap(grace);
        }

        throw new ServiceUnavailableException(timeoutError.message);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        parentSignal?.removeEventListener('abort', abortFromParent);
        resolveParentAbort = null;
      }
    } finally {
      this.running -= 1;

      const next = this.queue.shift();
      if (next) next();

      this.logger.log(
        `Collector task finished${platform ? ` for ${platform}` : ''}. Running: ${this.running}`,
      );
    }
  }

  /**
   * Returns the current collector queue status.
   */
  getStatus(): CollectorQueueStatus {
    return {
      running: this.running,
      waiting: this.queue.length,
      concurrency: this.concurrency,
      maxQueueSize: this.maxQueueSize,
    };
  }

  /**
   * Resolves optional task metadata into a readable platform name.
   *
   * @param metadata Platform metadata or a direct platform name.
   * @returns The platform name when available.
   */
  private resolvePlatform(
    metadata?: QueueTaskMetadata | string,
  ): string | undefined {
    if (!metadata) {
      return undefined;
    }

    if (typeof metadata === 'string') {
      return metadata;
    }

    return metadata.platform;
  }

  /**
   * Reads a positive numeric configuration value.
   *
   * Invalid, missing, zero, or negative values fall back to
   * the provided default value.
   *
   * @param key Environment variable key.
   * @param defaultValue Safe fallback value.
   * @returns A valid positive number.
   */
  private getPositiveNumber(key: string, defaultValue: number): number {
    const value = Number(this.configService.get<unknown>(key));

    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }
}