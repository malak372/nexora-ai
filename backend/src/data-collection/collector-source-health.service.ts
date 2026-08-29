import { Injectable } from '@nestjs/common';

type SourceHealthState = {
  successes: number;
  failures: number;
  emptyRuns: number;
  yieldedItems: number;
  latencyMsTotal: number;
  cooldownUntil: number;
};

/**
 * Lightweight in-memory health/yield memory for collectors.
 *
 * It is intentionally runtime-local: it guides source selection inside the
 * current backend process without creating database coupling. Collector
 * failures remain non-fatal, but repeatedly failing/empty sources are deprioritized
 * for later generation runs. Explicitly requested sources are never blocked by
 * this service; callers may choose to keep them regardless of score.
 */
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
      /*
       * Empty yield is query-scoped, not proof that the source is globally
       * unhealthy. Keep it as a ranking penalty, but do not open a global
       * cooldown that could suppress the same source for the next unrelated
       * domain. The current-run recovery layer already excludes sources that
       * returned zero for this exact request.
       */
    } else {
      state.emptyRuns = Math.max(0, state.emptyRuns - 1);
      state.cooldownUntil = 0;
    }
    state.failures = Math.max(0, state.failures - 1);
  }

  recordFailure(sourceKey: string, latencyMs: number): void {
    const state = this.getOrCreate(sourceKey);
    state.failures += 1;
    state.latencyMsTotal += Math.max(0, latencyMs);
    if (state.failures >= 2) {
      state.cooldownUntil = Date.now() + 60_000;
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
    const emptyPenalty = Math.min(0.45, state.emptyRuns * 0.12);
    const failurePenalty = Math.min(0.5, state.failures * 0.16);
    const yieldBoost = Math.min(0.35, averageYield / 30);
    return Math.max(0.1, Math.min(1.25, 0.55 + successRate * 0.35 + yieldBoost - emptyPenalty - failurePenalty));
  }


  isHealthy(sourceKey: string, minimumScore = 0.35): boolean {
    return !this.isTemporarilyDegraded(sourceKey) && this.score(sourceKey) >= minimumScore;
  }

  isTemporarilyDegraded(sourceKey: string): boolean {
    const state = this.state.get(sourceKey.toLocaleLowerCase());
    return Boolean(state && state.cooldownUntil > Date.now());
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
    };
    this.state.set(key, created);
    return created;
  }
}
