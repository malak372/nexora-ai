import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Process-local abort context shared by collector transport helpers.
 *
 * Idea generation executes many collectors in parallel. Passing the same
 * AbortSignal through every individual collector method would require touching
 * every source implementation, so the data-collection layer installs the
 * current run signal once and the shared HTTP/cache helpers consume it here.
 * Manual collection runs without a signal and keeps its existing behavior.
 */
export class CollectorAbortContextUtil {
  private static readonly storage = new AsyncLocalStorage<AbortSignal>();

  static run<T>(
    signal: AbortSignal | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (!signal) {
      return callback();
    }

    if (signal.aborted) {
      return Promise.reject(this.createAbortError());
    }

    return this.storage.run(signal, callback);
  }

  static getSignal(): AbortSignal | undefined {
    return this.storage.getStore();
  }

  static throwIfAborted(signal = this.getSignal()): void {
    if (signal?.aborted) {
      throw this.createAbortError();
    }
  }

  static async raceWithAbort<T>(promise: Promise<T>): Promise<T> {
    const signal = this.getSignal();
    if (!signal) {
      return promise;
    }

    if (signal.aborted) {
      throw this.createAbortError();
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.createAbortError());
      signal.addEventListener('abort', onAbort, { once: true });

      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  static async sleep(ms: number): Promise<void> {
    const signal = this.getSignal();
    if (!signal) {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
      return;
    }

    if (signal.aborted) {
      throw this.createAbortError();
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      timeout.unref?.();

      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        reject(this.createAbortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  static isAbortError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        error.name === 'AbortError' ||
        message === 'aborted' ||
        message.includes('cancelled') ||
        message.includes('canceled')
      );
    }

    return false;
  }

  private static createAbortError(): Error {
    const error = new Error('Collector operation cancelled.');
    error.name = 'AbortError';
    return error;
  }
}
