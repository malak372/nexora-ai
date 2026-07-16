import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AiModel, AiRoutingStrategy } from '@prisma/client';

import { AiModelsService } from './ai-models.service';

import { AiRoutingCostContext } from './types/ai-model-routing.type';

/**
 * Resolves model execution order.
 *
 * @author Malak
 */
@Injectable()
export class AiModelRoutingService {
  constructor(private readonly aiModelsService: AiModelsService) {}

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

  private orderDefaultFirst(models: readonly AiModel[]): AiModel[] {
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

  private orderByEstimatedCost(
    models: readonly AiModel[],
    context: AiRoutingCostContext,
  ): AiModel[] {
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

      if (first.priority !== second.priority) {
        return second.priority - first.priority;
      }

      return first.createdAt.getTime() - second.createdAt.getTime();
    });
  }

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

  private orderBalanced(models: readonly AiModel[]): AiModel[] {
    const remaining = [...models];
    const ordered: AiModel[] = [];

    while (remaining.length > 0) {
      const totalWeight = remaining.reduce(
        (sum, model) => sum + Math.max(model.weight, 1),
        0,
      );

      let cursor = Math.random() * totalWeight;
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

  private validateCostContext(context: AiRoutingCostContext): void {
    const values = [
      context.estimatedInputTokens,
      context.estimatedOutputTokens,
    ];

    const invalid = values.some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 0),
    );

    if (invalid) {
      throw new BadRequestException(
        'Estimated token counts must be non-negative integers.',
      );
    }
  }

  private assertNever(value: never): never {
    throw new ServiceUnavailableException(
      `Unsupported AI routing strategy: ${String(value)}`,
    );
  }
}
