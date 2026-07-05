import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Represents an asynchronous task executed by the collector queue.
 *
 * @template T Task return type.
 */
type QueueTask<T> = () => Promise<T>;

/**
 * Service responsible for limiting concurrent execution of
 * data collection tasks.
 *
 * This queue helps prevent excessive simultaneous requests to
 * external APIs, reducing the likelihood of rate limiting and
 * improving overall system stability.
 *
 * Features:
 * - Configurable concurrency.
 * - FIFO (First-In, First-Out) task scheduling.
 * - Queue status monitoring.
 * - Execution logging.
 *
 * The maximum number of concurrent tasks is configured using:
 * COLLECTOR_QUEUE_CONCURRENCY
 *
 * @author Malak
 */
@Injectable()
export class CollectorQueueService {
  /**
   * Logger used for queue execution events.
   */
  private readonly logger = new Logger(CollectorQueueService.name);

  /**
   * Number of tasks currently being executed.
   */
  private running = 0;

  /**
   * Queue of waiting tasks.
   *
   * Tasks are processed in FIFO order as execution slots
   * become available.
   */
  private readonly queue: Array<() => void> = [];

  /**
   * Maximum number of tasks allowed to run concurrently.
   */
  private readonly concurrency: number;

  /**
   * Creates the queue service.
   *
   * Reads the maximum concurrency value from the application
   * configuration. Defaults to 1 if not provided.
   *
   * @param configService NestJS configuration service.
   */
  constructor(private readonly configService: ConfigService) {
    this.concurrency =
      Number(this.configService.get('COLLECTOR_QUEUE_CONCURRENCY')) || 1;
  }

  /**
   * Executes a task using the collector queue.
   *
   * If the concurrency limit has been reached, the task waits
   * until a running task finishes.
   *
   * Once execution completes, the next waiting task (if any)
   * is automatically started.
   *
   * @template T Task return type.
   * @param task Asynchronous task to execute.
   * @returns Task result.
   */
  async run<T>(task: QueueTask<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.running++;

    try {
      this.logger.log(
        `Collector task started. Running: ${this.running}`,
      );

      return await task();
    } finally {
      this.running--;

      const next = this.queue.shift();

      if (next) {
        next();
      }

      this.logger.log(
        `Collector task finished. Running: ${this.running}`,
      );
    }
  }

  /**
   * Returns the current queue status.
   *
   * Useful for monitoring collector workload and debugging.
   *
   * @returns Queue statistics including:
   * - running tasks
   * - waiting tasks
   * - configured concurrency
   */
  getStatus() {
    return {
      running: this.running,
      waiting: this.queue.length,
      concurrency: this.concurrency,
    };
  }
}