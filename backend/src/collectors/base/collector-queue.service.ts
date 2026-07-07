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
 * Service responsible for limiting concurrent execution of
 * data collection tasks.
 *
 * This queue helps prevent excessive simultaneous requests to
 * external APIs, reducing the likelihood of rate limiting and
 * improving overall system stability.
 *
 * Features:
 * - Configurable concurrency.
 * - Configurable maximum waiting queue size.
 * - FIFO task scheduling.
 * - Queue status monitoring.
 * - Execution logging.
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
    this.concurrency = this.getPositiveNumber(
      'COLLECTOR_QUEUE_CONCURRENCY',
      1,
    );

    this.maxQueueSize = this.getPositiveNumber(
      'COLLECTOR_QUEUE_MAX_SIZE',
      100,
    );
  }

  /**
   * Executes a task using the collector queue.
   *
   * If the concurrency limit is reached, the task waits.
   * If the queue is full, the request is rejected safely.
   */
  async run<T>(task: QueueTask<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new ServiceUnavailableException(
          'Collector queue is full. Please try again later.',
        );
      }

      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.running++;

    try {
      this.logger.log(`Collector task started. Running: ${this.running}`);

      return await task();
    } finally {
      this.running--;

      const next = this.queue.shift();

      if (next) {
        next();
      }

      this.logger.log(`Collector task finished. Running: ${this.running}`);
    }
  }

  /**
   * Returns current queue status.
   */
  getStatus() {
    return {
      running: this.running,
      waiting: this.queue.length,
      concurrency: this.concurrency,
      maxQueueSize: this.maxQueueSize,
    };
  }

  /**
   * Reads a positive numeric configuration value.
   */
  private getPositiveNumber(key: string, defaultValue: number): number {
    const value = Number(this.configService.get(key));

    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }
}