import { Injectable } from '@nestjs/common';
import type { AiModel } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  IDEA_BENCHMARK_INITIAL_MODEL_COUNT,
  IDEA_BENCHMARK_RECENT_RUN_LOOKBACK,
} from '../constants/idea-generation.constants';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

/**
 * Selects a rotating, health-aware model order for one generation run.
 *
 * Selection rules:
 * - Only models already deemed routable by AiModelsService are accepted.
 * - Models used in the requester's most recent runs are deprioritized.
 * - Higher priority and healthier models remain preferred.
 * - The order is stable for the same run ID, which keeps retries deterministic.
 *
 * The benchmark initially executes only the first configured models. Remaining
 * models are retained as fallbacks and may be executed when too few valid
 * candidates are produced.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationModelSelectorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the complete ordered pool. The caller decides how many models to
   * execute initially and how many fallback attempts are allowed.
   */
  async orderModels(
    context: IdeaGenerationContext,
    eligibleModels: readonly AiModel[],
  ): Promise<AiModel[]> {
    if (eligibleModels.length <= 1) {
      return [...eligibleModels];
    }

    const recentModelIds = await this.findRecentlyUsedModelIds(context);
    const seed = this.hash(context.runId);

    return [...eligibleModels].sort((first, second) => {
      const firstRecentlyUsed = recentModelIds.has(first.id) ? 1 : 0;
      const secondRecentlyUsed = recentModelIds.has(second.id) ? 1 : 0;

      if (firstRecentlyUsed !== secondRecentlyUsed) {
        return firstRecentlyUsed - secondRecentlyUsed;
      }

      const healthDifference =
        this.healthRank(first.healthStatus) - this.healthRank(second.healthStatus);

      if (healthDifference !== 0) {
        return healthDifference;
      }

      const priorityDifference = second.priority - first.priority;

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return (
        this.hash(`${seed}:${first.id}`) - this.hash(`${seed}:${second.id}`)
      );
    });
  }

  /**
   * Convenience helper used by tests and diagnostics.
   */
  getInitialModels(orderedModels: readonly AiModel[]): AiModel[] {
    return orderedModels.slice(0, IDEA_BENCHMARK_INITIAL_MODEL_COUNT);
  }

  private async findRecentlyUsedModelIds(
    context: IdeaGenerationContext,
  ): Promise<Set<string>> {
    const ownerWhere =
      context.owner.type === 'USER'
        ? { userId: context.owner.userId }
        : { guestSessionId: context.owner.guestSessionId };

    const recentRuns = await this.prisma.ideaGenerationRun.findMany({
      where: {
        ...ownerWhere,
        id: { not: context.runId },
        benchmarkCandidates: { some: {} },
      },
      select: {
        benchmarkCandidates: {
          select: { aiModelId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: IDEA_BENCHMARK_RECENT_RUN_LOOKBACK,
    });

    return new Set(
      recentRuns.flatMap((run) =>
        run.benchmarkCandidates
          .map((candidate) => candidate.aiModelId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
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