import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AiRoutingStrategy } from '@prisma/client';

import type { AiModel } from '@prisma/client';

import { AiModelsService } from './ai-models.service';

import type { AiRoutingCostContext } from './types/ai-model-routing.type';

/**
 * Service responsible for resolving the order in which routable
 * AI models should be executed.
 *
 * The service supports the following routing strategies:
 *
 * - DEFAULT:
 *   Places the configured default model first, then orders the remaining
 *   models by priority and creation time.
 *
 * - LOWEST_COST:
 *   Estimates the execution cost of each model using the supplied token
 *   counts and places the least expensive model first.
 *
 * - BALANCED:
 *   Produces a weighted-random execution order using each model's
 *   configured routing weight.
 *
 * Only active, supported, and operationally routable models are returned
 * by AiModelsService and considered by this service.
 *
 * @author Malak
 */
@Injectable()
export class AiModelRoutingService {
  constructor(private readonly aiModelsService: AiModelsService) {}

  /**
   * Resolves the ordered list of AI models that should be attempted for
   * one logical AI execution.
   *
   * The first model in the returned array is the preferred model. The
   * remaining models may be used as fallbacks if the preferred model
   * fails.
   *
   * @param strategy Routing strategy used to order available models.
   * Defaults to DEFAULT.
   * @param costContext Optional token estimates used by the LOWEST_COST
   * strategy.
   * @returns Ordered list of routable AI models.
   *
   * @throws BadRequestException When estimated token counts are invalid.
   * @throws ServiceUnavailableException When no routable AI model exists.
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
   * Orders models according to the default routing strategy.
   *
   * Ordering rules:
   * 1. The configured default model is placed first.
   * 2. Models with higher numeric priority are preferred.
   * 3. Older models are preferred when priorities are equal.
   *
   * The input array is not mutated.
   *
   * @param models Routable AI models.
   * @returns Newly ordered AI-model array.
   */
  private orderDefaultFirst(models: readonly AiModel[]): AiModel[] {
    return [...models].sort((first, second) => {
      if (first.isDefault !== second.isDefault) {
        return first.isDefault ? -1 : 1;
      }

      return this.compareFallbackOrder(first, second);
    });
  }

  /**
   * Orders models from the lowest estimated execution cost to the
   * highest estimated execution cost.
   *
   * Estimated cost is calculated from:
   * - Estimated input-token count.
   * - Estimated output-token count.
   * - Model input cost per one million tokens.
   * - Model output cost per one million tokens.
   *
   * When two models have the same estimated cost, priority and creation
   * time are used as deterministic tie-breakers.
   *
   * The input array is not mutated.
   *
   * @param models Routable AI models.
   * @param context Estimated token usage for the requested execution.
   * @returns Newly ordered AI-model array.
   */
  private orderByEstimatedCost(
    models: readonly AiModel[],
    context: AiRoutingCostContext,
  ): AiModel[] {
    /*
     * A default estimate of one token prevents an omitted context from
     * making every model appear to have exactly zero execution cost.
     *
     * Explicit zero values remain valid because the nullish-coalescing
     * operator does not replace zero.
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

      return this.compareFallbackOrder(first, second);
    });
  }

  /**
   * Calculates the estimated monetary cost of executing one model.
   *
   * Model prices are stored per one million tokens. Therefore, each
   * token estimate is divided by 1,000,000 before being multiplied by
   * its corresponding price.
   *
   * @param model AI model whose execution cost is being estimated.
   * @param inputTokens Estimated number of input tokens.
   * @param outputTokens Estimated number of output tokens.
   * @returns Estimated total execution cost.
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
   * Produces a weighted-random model execution order.
   *
   * Models with greater weight have a higher probability of being
   * selected earlier. Each selected model is removed from the candidate
   * pool, producing a complete weighted permutation without duplicates.
   *
   * A minimum effective weight of one is used defensively so that an
   * invalid zero or negative persisted value cannot break selection.
   *
   * The input array is not mutated.
   *
   * @param models Routable AI models.
   * @returns Weighted-random ordering of the supplied models.
   */
  private orderBalanced(models: readonly AiModel[]): AiModel[] {
    const remaining = [...models];

    const ordered: AiModel[] = [];

    while (remaining.length > 0) {
      const totalWeight = remaining.reduce(
        (sum, model) => sum + this.resolveEffectiveWeight(model),
        0,
      );

      let cursor = Math.random() * totalWeight;

      /*
       * The final model is used as a defensive fallback against
       * floating-point boundary behavior.
       */
      let selectedIndex = remaining.length - 1;

      for (let index = 0; index < remaining.length; index += 1) {
        cursor -= this.resolveEffectiveWeight(remaining[index]);

        if (cursor <= 0) {
          selectedIndex = index;

          break;
        }
      }

      const [selectedModel] = remaining.splice(selectedIndex, 1);

      ordered.push(selectedModel);
    }

    return ordered;
  }

  /**
   * Returns the effective routing weight of one model.
   *
   * The persisted model weight is expected to be positive. A minimum
   * value of one is still applied defensively in case legacy or manually
   * modified data contains a zero or negative value.
   *
   * @param model AI model being considered for weighted routing.
   * @returns Positive effective routing weight.
   */
  private resolveEffectiveWeight(model: AiModel): number {
    return Math.max(model.weight, 1);
  }

  /**
   * Applies deterministic fallback ordering between two models.
   *
   * Ordering rules:
   * 1. Higher numeric priority is preferred.
   * 2. Older creation time is preferred when priorities are equal.
   *
   * @param first First model being compared.
   * @param second Second model being compared.
   * @returns Negative, positive, or zero according to Array.sort()
   * comparison rules.
   */
  private compareFallbackOrder(first: AiModel, second: AiModel): number {
    if (first.priority !== second.priority) {
      return second.priority - first.priority;
    }

    return first.createdAt.getTime() - second.createdAt.getTime();
  }

  /**
   * Validates optional token estimates used for cost-based routing.
   *
   * Token counts must be:
   * - Integers.
   * - Greater than or equal to zero.
   *
   * Undefined values are allowed and are replaced by internal default
   * estimates during cost calculation.
   *
   * @param context Routing cost-estimation context.
   *
   * @throws BadRequestException When one of the supplied token counts
   * is negative, fractional, NaN, or otherwise non-integer.
   */
  private validateCostContext(context: AiRoutingCostContext): void {
    const tokenCounts = [
      context.estimatedInputTokens,
      context.estimatedOutputTokens,
    ];

    const hasInvalidTokenCount = tokenCounts.some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 0),
    );

    if (hasInvalidTokenCount) {
      throw new BadRequestException(
        'Estimated token counts must be non-negative integers.',
      );
    }
  }

  /**
   * Provides an exhaustive guard for AiRoutingStrategy.
   *
   * TypeScript reports a compile-time error when a new strategy is added
   * to the enum without being handled by resolveExecutionOrder().
   *
   * @param value Unhandled routing-strategy value.
   * @throws ServiceUnavailableException Always.
   */
  private assertNever(value: never): never {
    throw new ServiceUnavailableException(
      `Unsupported AI routing strategy: ${String(value)}`,
    );
  }
}
