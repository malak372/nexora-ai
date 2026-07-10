import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiModel, AiRoutingStrategy } from '@prisma/client';

import { AiModelsService } from './ai-models.service';

import { AiRoutingCostContext } from './types/ai-model-routing.type';

/**
 * Service responsible for resolving AI-model execution order.
 *
 * This service selects and orders models but does not call external
 * AI providers.
 *
 * Supported strategies:
 * - DEFAULT:
 *   Configured default model first, then fallback priority.
 *
 * - LOWEST_COST:
 *   Lowest estimated request cost first.
 *
 * - BALANCED:
 *   Weighted random execution order without duplicate models.
 *
 * @author Malak
 */
@Injectable()
export class AiModelRoutingService {
  constructor(private readonly aiModelsService: AiModelsService) {}

  /**
   * Returns AI models in the order in which they should be attempted.
   *
   * Unavailable and inactive models are already excluded by
   * AiModelsService.getRoutableModels().
   */
  async resolveExecutionOrder(
    strategy: AiRoutingStrategy = AiRoutingStrategy.DEFAULT,

    costContext: AiRoutingCostContext = {},
  ): Promise<AiModel[]> {
    this.validateCostContext(costContext);

    const models = await this.aiModelsService.getRoutableModels();

    if (models.length === 0) {
      throw new ServiceUnavailableException(
        'No routable AI model is currently available.',
      );
    }

    switch (strategy) {
      case AiRoutingStrategy.DEFAULT:
        return this.orderDefaultFirst(models);

      case AiRoutingStrategy.LOWEST_COST:
        return this.orderByEstimatedCost(models, costContext);

      case AiRoutingStrategy.BALANCED:
        return this.orderBalanced(models);

      default:
        return this.assertNever(strategy);
    }
  }

  /**
   * Places the configured default model first.
   *
   * Remaining models are ordered by:
   * 1. Higher priority.
   * 2. Older creation date.
   */
  private orderDefaultFirst(models: AiModel[]): AiModel[] {
    return [...models].sort((first, second) => {
      if (first.isDefault !== second.isDefault) {
        return first.isDefault ? -1 : 1;
      }

      if (first.priority !== second.priority) {
        return second.priority - first.priority;
      }

      return first.createdAt.getTime() - second.createdAt.getTime();
    });
  }

  /**
   * Sorts models by estimated provider request cost.
   *
   * Estimated cost:
   *
   * input price × estimated input tokens
   * +
   * output price × estimated output tokens
   *
   * Prices are configured per one million tokens.
   */
  private orderByEstimatedCost(
    models: AiModel[],
    context: AiRoutingCostContext,
  ): AiModel[] {
    /*
     * A value of one allows fair price comparison when an exact
     * token estimate is not available.
     */
    const inputTokens = context.estimatedInputTokens ?? 1;

    const outputTokens = context.estimatedOutputTokens ?? 1;

    return [...models].sort((first, second) => {
      const firstCost = this.calculateEstimatedCost(
        first,
        inputTokens,
        outputTokens,
      );

      const secondCost = this.calculateEstimatedCost(
        second,
        inputTokens,
        outputTokens,
      );

      if (firstCost !== secondCost) {
        return firstCost - secondCost;
      }

      /*
       * Prefer higher priority when estimated costs are equal.
       */
      if (first.priority !== second.priority) {
        return second.priority - first.priority;
      }

      return first.createdAt.getTime() - second.createdAt.getTime();
    });
  }

  /**
   * Calculates an estimated request cost using configured
   * per-million-token prices.
   */
  private calculateEstimatedCost(
    model: AiModel,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const inputCost =
      (model.inputCostPerMillion.toNumber() * inputTokens) / 1_000_000;

    const outputCost =
      (model.outputCostPerMillion.toNumber() * outputTokens) / 1_000_000;

    return inputCost + outputCost;
  }

  /**
   * Produces a weighted random execution order.
   *
   * Each model appears exactly once.
   *
   * Models with higher weights are more likely to appear earlier,
   * while all remaining models remain available as fallbacks.
   */
  private orderBalanced(models: AiModel[]): AiModel[] {
    const remaining = [...models];

    const ordered: AiModel[] = [];

    while (remaining.length > 0) {
      const totalWeight = remaining.reduce(
        (sum, model) => sum + Math.max(model.weight, 1),
        0,
      );

      let cursor = Math.random() * totalWeight;

      /*
       * Default to the final item to protect against floating-point
       * rounding when cursor does not become <= 0 in the loop.
       */
      let selectedIndex = remaining.length - 1;

      for (let index = 0; index < remaining.length; index += 1) {
        cursor -= Math.max(remaining[index].weight, 1);

        if (cursor <= 0) {
          selectedIndex = index;

          break;
        }
      }

      const [selected] = remaining.splice(selectedIndex, 1);

      ordered.push(selected);
    }

    return ordered;
  }

  /**
   * Validates optional routing token estimates.
   *
   * Token estimates must be non-negative integers.
   */
  private validateCostContext(context: AiRoutingCostContext): void {
    const values = [
      context.estimatedInputTokens,
      context.estimatedOutputTokens,
    ];

    const hasInvalidValue = values.some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 0),
    );

    if (hasInvalidValue) {
      throw new BadRequestException(
        'Estimated token counts must be non-negative integers.',
      );
    }
  }

  /**
   * Ensures future AiRoutingStrategy enum values are handled
   * explicitly.
   */
  private assertNever(value: never): never {
    throw new ServiceUnavailableException(
      `Unsupported AI routing strategy: ${String(value)}`,
    );
  }
}
