import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { AiRoutingStrategy } from '@prisma/client';

import type { AiModel } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AiModelsService } from './ai-models.service';

import type { AiRoutingCostContext } from './types/ai-model-routing.type';

const DEFAULT_PROVIDER_QUOTA_COOLDOWN_MINUTES = 15;
const MIN_PROVIDER_QUOTA_COOLDOWN_MINUTES = 1;
const MAX_PROVIDER_QUOTA_COOLDOWN_MINUTES = 24 * 60;

const DEFAULT_MODEL_TRANSIENT_COOLDOWN_MINUTES = 10;
const MIN_MODEL_TRANSIENT_COOLDOWN_MINUTES = 1;
const MAX_MODEL_TRANSIENT_COOLDOWN_MINUTES = 60;

const MODEL_TRANSIENT_ERROR_CODES = new Set([
  'RATE_LIMIT',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'NETWORK',
]);

/** A single transient provider hiccup must not disable a proven model across runs. */
const MODEL_TRANSIENT_FAILURES_REQUIRED_FOR_COOLDOWN = 2;

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
 *   Alternates providers whenever possible, then applies persisted routing
 *   weights inside each provider. Provider probability is based on average
 *   model weight so providers with more database rows receive no unfair bias.
 *
 * Only active, supported, and operationally routable models are returned
 * by AiModelsService and considered by this service.
 *
 * @author Malak
 */
@Injectable()
export class AiModelRoutingService {
  /**
   * In-memory cursor used to rotate the first provider of balanced operations.
   *
   * The cursor guarantees that consecutive operations handled by one backend
   * instance do not always begin with the same provider when alternatives are
   * healthy and routable. Fallback ordering still alternates providers inside
   * each individual operation.
   */
  private balancedProviderCursor = 0;

  /** Duration for which an account-level provider quota failure is cached. */
  private readonly providerQuotaCooldownMs: number;

  /**
   * Duration used to inspect recent transient model failures. A model is
   * skipped across runs only after repeated consecutive failures; one isolated
   * timeout remains eligible on the next run while same-run blocking is handled
   * by the caller.
   */
  private readonly modelTransientCooldownMs: number;

  constructor(
    private readonly aiModelsService: AiModelsService,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const configuredMinutes = Number(
      configService.get<string>('AI_PROVIDER_QUOTA_COOLDOWN_MINUTES'),
    );
    const cooldownMinutes =
      Number.isInteger(configuredMinutes) &&
      configuredMinutes >= MIN_PROVIDER_QUOTA_COOLDOWN_MINUTES &&
      configuredMinutes <= MAX_PROVIDER_QUOTA_COOLDOWN_MINUTES
        ? configuredMinutes
        : DEFAULT_PROVIDER_QUOTA_COOLDOWN_MINUTES;

    this.providerQuotaCooldownMs = cooldownMinutes * 60 * 1_000;

    const configuredModelCooldownMinutes = Number(
      configService.get<string>('AI_MODEL_TRANSIENT_COOLDOWN_MINUTES'),
    );
    const modelCooldownMinutes =
      Number.isInteger(configuredModelCooldownMinutes) &&
      configuredModelCooldownMinutes >= MIN_MODEL_TRANSIENT_COOLDOWN_MINUTES &&
      configuredModelCooldownMinutes <= MAX_MODEL_TRANSIENT_COOLDOWN_MINUTES
        ? configuredModelCooldownMinutes
        : DEFAULT_MODEL_TRANSIENT_COOLDOWN_MINUTES;

    this.modelTransientCooldownMs = modelCooldownMinutes * 60 * 1_000;
  }

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

    const routableModels = await this.aiModelsService.getRoutableModels();
    const models =
      await this.filterTemporarilyUnavailableProviders(routableModels);

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
   * Resolves one exact model for an explicit benchmark execution.
   *
   * The lookup is intentionally performed against the routable-model list so
   * inactive, unsupported, or unhealthy models cannot be forced by callers.
   * Adding, disabling, or deleting AiModel rows therefore changes benchmark
   * participation automatically without any hard-coded model registry.
   *
   * @param modelId AiModel database identifier.
   * @returns Exact routable model.
   * @throws ServiceUnavailableException when the model is not routable.
   */
  async resolveSpecificModel(
    modelId: string,
    allowTemporaryCooldownBypass = false,
    allowBoundedEmergencyAttempt = false,
  ): Promise<AiModel> {
    const normalizedModelId = modelId.trim();

    if (!normalizedModelId) {
      throw new BadRequestException('AI model identifier is required.');
    }

    const routableModels = await this.aiModelsService.getRoutableModels();
    let configuredModel = routableModels.find(
      (candidate) => candidate.id === normalizedModelId,
    );

    if (!configuredModel && allowBoundedEmergencyAttempt) {
      const emergencyModels =
        await this.aiModelsService.getFallbackModels();
      configuredModel = emergencyModels.find(
        (candidate) => candidate.id === normalizedModelId,
      );
      if (configuredModel) {
        return configuredModel;
      }
    }

    if (!configuredModel) {
      throw new ServiceUnavailableException(
        `AI model "${normalizedModelId}" is not active or routable.`,
      );
    }

    const models =
      await this.filterTemporarilyUnavailableProviders(routableModels);
    const model = models.find(
      (candidate) => candidate.id === normalizedModelId,
    );

    if (!model) {
      if (allowTemporaryCooldownBypass || allowBoundedEmergencyAttempt) {
        return configuredModel;
      }

      throw new ServiceUnavailableException(
        `AI model "${configuredModel.displayName ?? configuredModel.modelName}" is temporarily unavailable because of a recent provider quota, rate-limit, or availability failure.`,
      );
    }

    return model;
  }

  /**
   * Removes account-level quota failures and temporarily overloaded models.
   *
   * Provider-wide blocking is reserved for INSUFFICIENT_QUOTA because a
   * generic OpenRouter 429 may affect only one free model or upstream host.
   * RATE_LIMIT and PROVIDER_UNAVAILABLE therefore create a model-level
   * cooldown only after repeated consecutive transient failures. Other models
   * from the same provider remain eligible, and a later success resets the run.
   */
  async filterTemporarilyUnavailableProviders(
    models: readonly AiModel[],
  ): Promise<AiModel[]> {
    if (models.length === 0) {
      return [];
    }

    const providerKeys = [...new Set(models.map((model) => model.providerKey))];
    const modelIds = models.map((model) => model.id);
    const providerCutoff = new Date(Date.now() - this.providerQuotaCooldownMs);
    const modelCutoff = new Date(Date.now() - this.modelTransientCooldownMs);
    const earliestCutoff =
      providerCutoff.getTime() < modelCutoff.getTime()
        ? providerCutoff
        : modelCutoff;

    const recentLogs = await this.prisma.externalApiLog.findMany({
      where: {
        providerKey: { in: providerKeys },
        createdAt: { gte: earliestCutoff },
        OR: [{ aiModelId: { in: modelIds } }, { aiModelId: null }],
      },
      select: {
        providerKey: true,
        aiModelId: true,
        isSuccess: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestLogByProvider = new Map<
      string,
      {
        readonly isSuccess: boolean;
        readonly errorCode: string | null;
        readonly createdAt: Date;
      }
    >();
    const recentLogsByModel = new Map<
      string,
      Array<{
        readonly isSuccess: boolean;
        readonly errorCode: string | null;
        readonly createdAt: Date;
      }>
    >();

    for (const log of recentLogs) {
      if (
        log.createdAt >= providerCutoff &&
        (log.isSuccess || log.errorCode === 'INSUFFICIENT_QUOTA') &&
        !latestLogByProvider.has(log.providerKey)
      ) {
        latestLogByProvider.set(log.providerKey, {
          isSuccess: log.isSuccess,
          errorCode: log.errorCode,
          createdAt: log.createdAt,
        });
      }

      if (log.aiModelId && log.createdAt >= modelCutoff) {
        const modelLogs = recentLogsByModel.get(log.aiModelId) ?? [];
        modelLogs.push({
          isSuccess: log.isSuccess,
          errorCode: log.errorCode,
          createdAt: log.createdAt,
        });
        recentLogsByModel.set(log.aiModelId, modelLogs);
      }
    }

    const blockedProviders = new Set<string>();
    const blockedModels = new Set<string>();

    for (const [providerKey, latestLog] of latestLogByProvider) {
      if (
        !latestLog.isSuccess &&
        latestLog.errorCode === 'INSUFFICIENT_QUOTA'
      ) {
        blockedProviders.add(providerKey);
      }
    }

    for (const [modelId, modelLogs] of recentLogsByModel) {
      let consecutiveTransientFailures = 0;

      for (const log of modelLogs) {
        if (log.isSuccess) {
          break;
        }

        if (
          log.errorCode === null ||
          !MODEL_TRANSIENT_ERROR_CODES.has(log.errorCode)
        ) {
          break;
        }

        consecutiveTransientFailures += 1;
      }

      if (
        consecutiveTransientFailures >=
        MODEL_TRANSIENT_FAILURES_REQUIRED_FOR_COOLDOWN
      ) {
        blockedModels.add(modelId);
      }
    }

    return models.filter(
      (model) =>
        !blockedProviders.has(model.providerKey) &&
        !blockedModels.has(model.id),
    );
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
   * Produces a provider-aware weighted execution order.
   *
   * Consecutive selections use different providers whenever possible. Within
   * each provider, models with greater persisted weight have a higher chance
   * of being selected earlier. Provider selection uses average model weight,
   * preventing a provider from winning merely because it has more model rows.
   * A minimum effective weight of one is applied defensively.
   *
   * The input array is not mutated.
   *
   * @param models Routable AI models.
   * @returns Provider-rotated weighted ordering of the supplied models.
   */
  private orderBalanced(models: readonly AiModel[]): AiModel[] {
    const providerPools = new Map<string, AiModel[]>();

    for (const model of models) {
      const providerModels = providerPools.get(model.providerKey) ?? [];
      providerModels.push(model);
      providerPools.set(model.providerKey, providerModels);
    }

    const ordered: AiModel[] = [];
    let previousProvider: string | null = null;
    const rotatingInitialProvider = this.selectRotatingInitialProvider(
      [...providerPools.keys()].sort(),
    );

    while (providerPools.size > 0) {
      const availableProviders = [...providerPools.keys()];
      const alternativeProviders = previousProvider
        ? availableProviders.filter((provider) => provider !== previousProvider)
        : availableProviders;
      const providerCandidates =
        alternativeProviders.length > 0
          ? alternativeProviders
          : availableProviders;
      const selectedProvider: string =
        previousProvider === null && providerPools.has(rotatingInitialProvider)
          ? rotatingInitialProvider
          : this.selectWeightedProvider(providerCandidates, providerPools);
      const providerModels: AiModel[] | undefined =
        providerPools.get(selectedProvider);

      if (!providerModels || providerModels.length === 0) {
        providerPools.delete(selectedProvider);
        continue;
      }

      const selectedIndex = this.selectWeightedModelIndex(providerModels);
      const [selectedModel] = providerModels.splice(selectedIndex, 1);

      if (!selectedModel) {
        providerPools.delete(selectedProvider);
        continue;
      }

      ordered.push(selectedModel);
      previousProvider = selectedProvider;

      if (providerModels.length === 0) {
        providerPools.delete(selectedProvider);
      }
    }

    return ordered;
  }

  /**
   * Rotates the first provider used by consecutive balanced operations.
   *
   * @param providers Sorted provider keys available for the operation.
   * @returns Provider that should receive the first attempt.
   */
  private selectRotatingInitialProvider(providers: readonly string[]): string {
    const provider =
      providers[this.balancedProviderCursor % Math.max(providers.length, 1)];

    if (!provider) {
      throw new ServiceUnavailableException(
        'No provider is available for balanced AI routing.',
      );
    }

    this.balancedProviderCursor =
      (this.balancedProviderCursor + 1) % providers.length;

    return provider;
  }

  /**
   * Selects a provider using its average model weight.
   *
   * Average weight prevents a provider from becoming more likely merely
   * because it has more configured model rows than another provider.
   */
  private selectWeightedProvider(
    providers: readonly string[],
    pools: ReadonlyMap<string, readonly AiModel[]>,
  ): string {
    const weightedProviders = providers.map((provider) => {
      const models = pools.get(provider) ?? [];
      const combinedWeight = models.reduce(
        (sum, model) => sum + this.resolveEffectiveWeight(model),
        0,
      );

      return {
        provider,
        weight: models.length > 0 ? combinedWeight / models.length : 1,
      };
    });
    const totalWeight = weightedProviders.reduce(
      (sum, item) => sum + Math.max(item.weight, 1),
      0,
    );
    let cursor = Math.random() * totalWeight;

    for (const item of weightedProviders) {
      cursor -= Math.max(item.weight, 1);

      if (cursor <= 0) {
        return item.provider;
      }
    }

    const fallbackProvider =
      weightedProviders[weightedProviders.length - 1]?.provider ?? providers[0];

    if (!fallbackProvider) {
      throw new ServiceUnavailableException(
        'No provider is available for balanced AI routing.',
      );
    }

    return fallbackProvider;
  }

  /** Selects one model inside a provider according to persisted model weight. */
  private selectWeightedModelIndex(models: readonly AiModel[]): number {
    const totalWeight = models.reduce(
      (sum, model) => sum + this.resolveEffectiveWeight(model),
      0,
    );
    let cursor = Math.random() * totalWeight;

    for (const [index, model] of models.entries()) {
      cursor -= this.resolveEffectiveWeight(model);

      if (cursor <= 0) {
        return index;
      }
    }

    return Math.max(models.length - 1, 0);
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