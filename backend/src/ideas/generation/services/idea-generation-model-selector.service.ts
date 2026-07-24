import { Injectable } from '@nestjs/common';
import type { AiModel } from '@prisma/client';

import { AiModelRoutingService } from '../../../ai-models/ai-model-routing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  IDEA_BENCHMARK_INITIAL_MODEL_COUNT,
  IDEA_BENCHMARK_RECENT_RUN_LOOKBACK,
} from '../constants/idea-generation.constants';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

type RecentModelUsage = {
  readonly modelIds: ReadonlySet<string>;
  readonly providerCounts: ReadonlyMap<string, number>;
};

/**
 * Selects a rotating, health-aware, provider-diverse model order.
 *
 * The first benchmark group is interleaved by provider. Therefore, when both
 * Google and OpenRouter have routable models, the benchmark does not execute
 * three Google models merely because their priorities are higher. Recent model
 * and provider usage is also deprioritized to keep later runs diverse.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationModelSelectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelRoutingService: AiModelRoutingService,
  ) {}

  async orderModels(
    context: IdeaGenerationContext,
    eligibleModels: readonly AiModel[],
  ): Promise<AiModel[]> {
    const availableModels =
      await this.modelRoutingService.filterTemporarilyUnavailableProviders(
        eligibleModels,
      );

    if (availableModels.length <= 1) {
      return [...availableModels];
    }

    const recentUsage = await this.findRecentUsage(context);
    const seed = this.hash(context.runId);
    const modelsByProvider = new Map<string, AiModel[]>();

    for (const model of availableModels) {
      const providerModels = modelsByProvider.get(model.providerKey) ?? [];
      providerModels.push(model);
      modelsByProvider.set(model.providerKey, providerModels);
    }

    for (const providerModels of modelsByProvider.values()) {
      providerModels.sort((first, second) =>
        this.compareModels(first, second, recentUsage.modelIds, seed),
      );
    }

    const providerKeys = [...modelsByProvider.keys()].sort((first, second) => {
      const usageDifference =
        (recentUsage.providerCounts.get(first) ?? 0) -
        (recentUsage.providerCounts.get(second) ?? 0);

      if (usageDifference !== 0) {
        return usageDifference;
      }

      const firstBest = modelsByProvider.get(first)?.[0];
      const secondBest = modelsByProvider.get(second)?.[0];

      if (firstBest && secondBest) {
        const healthDifference =
          this.healthRank(firstBest.healthStatus) -
          this.healthRank(secondBest.healthStatus);

        if (healthDifference !== 0) {
          return healthDifference;
        }

        if (firstBest.priority !== secondBest.priority) {
          return secondBest.priority - firstBest.priority;
        }
      }

      return this.hash(`${seed}:${first}`) - this.hash(`${seed}:${second}`);
    });

    const ordered: AiModel[] = [];
    let providerCursor = 0;

    while (ordered.length < availableModels.length) {
      const providerKey = providerKeys[providerCursor % providerKeys.length];
      const providerModels = modelsByProvider.get(providerKey);
      const model = providerModels?.shift();

      if (model) {
        ordered.push(model);
      }

      providerCursor += 1;

      if (providerCursor > availableModels.length * providerKeys.length * 2) {
        break;
      }
    }

    return ordered;
  }

  /**
   * Returns the provider-diverse initial benchmark group.
   *
   * At most one model per provider is started concurrently. Additional models
   * are attempted sequentially only when the initial group does not produce
   * enough accepted candidates. This avoids sending multiple simultaneous
   * requests to an account whose provider-wide daily quota may already be
   * exhausted.
   */
  getInitialModels(orderedModels: readonly AiModel[]): AiModel[] {
    const selected: AiModel[] = [];
    const usedProviders = new Set<string>();

    for (const model of orderedModels) {
      if (selected.length >= IDEA_BENCHMARK_INITIAL_MODEL_COUNT) {
        break;
      }

      if (usedProviders.has(model.providerKey)) {
        continue;
      }

      usedProviders.add(model.providerKey);
      selected.push(model);
    }

    if (selected.length > 0) {
      return selected;
    }

    return orderedModels.slice(0, IDEA_BENCHMARK_INITIAL_MODEL_COUNT);
  }

  private compareModels(
    first: AiModel,
    second: AiModel,
    recentModelIds: ReadonlySet<string>,
    seed: number,
  ): number {
    const recentDifference =
      (recentModelIds.has(first.id) ? 1 : 0) -
      (recentModelIds.has(second.id) ? 1 : 0);

    if (recentDifference !== 0) {
      return recentDifference;
    }

    const healthDifference =
      this.healthRank(first.healthStatus) -
      this.healthRank(second.healthStatus);

    if (healthDifference !== 0) {
      return healthDifference;
    }

    if (first.priority !== second.priority) {
      return second.priority - first.priority;
    }

    return this.hash(`${seed}:${first.id}`) - this.hash(`${seed}:${second.id}`);
  }

  private async findRecentUsage(
    context: IdeaGenerationContext,
  ): Promise<RecentModelUsage> {
    const ownerWhere =
      context.owner.type === 'USER'
        ? { userId: context.owner.userId }
        : { guestSessionId: context.owner.guestSessionId };

    const recentRuns = await this.prisma.ideaGenerationRun.findMany({
      where: {
        ...ownerWhere,
        id: { not: context.runId },
        benchmarkCandidates: { some: { selected: true } },
      },
      select: {
        benchmarkCandidates: {
          where: { selected: true },
          select: { aiModelId: true, providerKey: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: IDEA_BENCHMARK_RECENT_RUN_LOOKBACK,
    });

    const modelIds = new Set<string>();
    const providerCounts = new Map<string, number>();

    for (const candidate of recentRuns.flatMap(
      (run) => run.benchmarkCandidates,
    )) {
      if (candidate.aiModelId) {
        modelIds.add(candidate.aiModelId);
      }

      providerCounts.set(
        candidate.providerKey,
        (providerCounts.get(candidate.providerKey) ?? 0) + 1,
      );
    }

    return { modelIds, providerCounts };
  }

  private healthRank(status: AiModel['healthStatus']): number {
    switch (status) {
      case 'HEALTHY':
        return 0;
      case 'UNKNOWN':
        return 1;
      case 'DEGRADED':
        return 2;
      default:
        return 3;
    }
  }

  private hash(value: string): number {
    let result = 2166136261;

    for (const character of value) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }

    return result >>> 0;
  }
}
