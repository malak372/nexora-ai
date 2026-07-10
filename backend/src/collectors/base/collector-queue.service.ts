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
type QueueTask<T> = () => Promise<T>;

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
    this.concurrency = this.getPositiveNumber('COLLECTOR_QUEUE_CONCURRENCY', 1);

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

    if (this.running >= this.concurrency) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new ServiceUnavailableException(
          'Collector queue is full. Please try again later.',
        );
      }

      this.logger.debug(
        `Collector task queued${
          platform ? ` for ${platform}` : ''
        }. Waiting: ${this.queue.length + 1}`,
      );

      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.running += 1;

    try {
      this.logger.log(
        `Collector task started${
          platform ? ` for ${platform}` : ''
        }. Running: ${this.running}`,
      );

      return await task();
    } finally {
      this.running -= 1;

      const next = this.queue.shift();

      if (next) {
        next();
      }

      this.logger.log(
        `Collector task finished${
          platform ? ` for ${platform}` : ''
        }. Running: ${this.running}`,
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
