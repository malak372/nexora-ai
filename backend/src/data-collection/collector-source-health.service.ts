import { Injectable } from '@nestjs/common';

type SourceHealthState = {
  successes: number;
  failures: number;
  emptyRuns: number;
  yieldedItems: number;
  latencyMsTotal: number;
  cooldownUntil: number;
  lastFailureKind: CollectorFailureKind | null;
};

type CollectorFailureKind =
  | 'RATE_LIMIT'
  | 'AUTH_OR_QUOTA'
  | 'TIMEOUT_OR_NETWORK'
  | 'SERVER_TRANSIENT'
  | 'OTHER';

@Injectable()
export class CollectorSourceHealthService {
  private readonly state = new Map<string, SourceHealthState>();

  recordSuccess(sourceKey: string, itemCount: number, latencyMs: number): void {
    const state = this.getOrCreate(sourceKey);
    state.successes += 1;
    state.yieldedItems += Math.max(0, itemCount);
    state.latencyMsTotal += Math.max(0, latencyMs);
    if (itemCount === 0) {
      state.emptyRuns += 1;
    } else {
      state.emptyRuns = Math.max(0, state.emptyRuns - 1);
      state.cooldownUntil = 0;
    }
    state.failures = Math.max(0, state.failures - 1);
    state.lastFailureKind = null;
  }

  recordFailure(
    sourceKey: string,
    latencyMs: number,
    error?: unknown,
  ): void {
    const state = this.getOrCreate(sourceKey);
    const failureKind = this.classifyFailure(error);
    const now = Date.now();

    state.failures += 1;
    state.latencyMsTotal += Math.max(0, latencyMs);
    state.lastFailureKind = failureKind;

    const cooldownMs = this.resolveCooldownMs(failureKind, state.failures);
    if (cooldownMs > 0) {
      state.cooldownUntil = Math.max(state.cooldownUntil, now + cooldownMs);
    }
  }

  score(sourceKey: string): number {
    const state = this.state.get(sourceKey.toLocaleLowerCase());
    if (!state) return 1;
    if (state.cooldownUntil > Date.now()) return 0.15;

    const attempts = Math.max(1, state.successes + state.failures);
    const successRate = state.successes / attempts;
    const averageYield = state.successes > 0
      ? state.yieldedItems / state.successes
      : 0;
    const averageLatencyMs = attempts > 0
      ? state.latencyMsTotal / attempts
      : 0;
    const emptyPenalty = Math.min(0.45, state.emptyRuns * 0.12);
    const failurePenalty = Math.min(0.5, state.failures * 0.16);
    const latencyPenalty = averageLatencyMs <= 3_000
      ? 0
      : Math.min(0.18, (averageLatencyMs - 3_000) / 30_000);
    const yieldBoost = Math.min(0.35, averageYield / 30);

    return Math.max(
      0.1,
      Math.min(
        1.25,
        0.55 +
          successRate * 0.35 +
          yieldBoost -
          emptyPenalty -
          failurePenalty -
          latencyPenalty,
      ),
    );
  }

  isHealthy(sourceKey: string, minimumScore = 0.35): boolean {
    return !this.isTemporarilyDegraded(sourceKey) && this.score(sourceKey) >= minimumScore;
  }

  isTemporarilyDegraded(sourceKey: string): boolean {
    const state = this.state.get(sourceKey.toLocaleLowerCase());
    return Boolean(state && state.cooldownUntil > Date.now());
  }

  private classifyFailure(error: unknown): CollectorFailureKind {
    const message = this.errorMessage(error).toLocaleLowerCase();

    if (/\b429\b|rate[ -]?limit|too many requests/.test(message)) {
      return 'RATE_LIMIT';
    }
    if (/quota|daily limit|usage limit|billing|forbidden|\b403\b|unauthori[sz]ed|\b401\b/.test(message)) {
      return 'AUTH_OR_QUOTA';
    }
    if (/timeout|timed out|abort|aborted|cancell?ed|econnreset|econnrefused|enotfound|etimedout|network|socket|fetch failed/.test(message)) {
      return 'TIMEOUT_OR_NETWORK';
    }
    if (/\b50[0234]\b|bad gateway|service unavailable|gateway timeout|upstream/.test(message)) {
      return 'SERVER_TRANSIENT';
    }
    return 'OTHER';
  }

  private resolveCooldownMs(
    failureKind: CollectorFailureKind,
    failureCount: number,
  ): number {
    switch (failureKind) {
      case 'RATE_LIMIT':
        return 60_000;
      case 'AUTH_OR_QUOTA':
        return 120_000;
      case 'TIMEOUT_OR_NETWORK':
      case 'SERVER_TRANSIENT':
        return 20_000;
      case 'OTHER':
        return failureCount >= 2 ? 60_000 : 0;
      default:
        return failureCount >= 2 ? 60_000 : 0;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const candidate = error as Record<string, unknown>;
      if (typeof candidate.message === 'string') return candidate.message;
      if (typeof candidate.code === 'string') return candidate.code;
      if (typeof candidate.status === 'number') return String(candidate.status);
    }
    return '';
  }

  private getOrCreate(sourceKey: string): SourceHealthState {
    const key = sourceKey.toLocaleLowerCase();
    const existing = this.state.get(key);
    if (existing) return existing;
    const created: SourceHealthState = {
      successes: 0,
      failures: 0,
      emptyRuns: 0,
      yieldedItems: 0,
      latencyMsTotal: 0,
      cooldownUntil: 0,
      lastFailureKind: null,
    };
    this.state.set(key, created);
    return created;
  }
}
