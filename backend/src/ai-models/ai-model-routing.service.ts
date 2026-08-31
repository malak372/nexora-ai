import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
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

const DEFAULT_MODEL_HARD_COOLDOWN_MINUTES = 6 * 60;
const MIN_MODEL_HARD_COOLDOWN_MINUTES = 15;
const MAX_MODEL_HARD_COOLDOWN_MINUTES = 7 * 24 * 60;

const MODEL_CROSS_RUN_TRANSIENT_ERROR_CODES = new Set([
  'RATE_LIMIT',
  'PROVIDER_UNAVAILABLE',
]);

/**
 * Model-specific failures that make another attempt against the same model
 * pointless until configuration/availability changes. Unlike transient
 * timeouts, one confirmed hard failure is enough to cool the model.
 */
const PROVIDER_HARD_UNAVAILABLE_ERROR_CODES = new Set([
  'INSUFFICIENT_QUOTA',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
]);

const MODEL_HARD_UNAVAILABLE_ERROR_CODES = new Set([
  'MODEL_NOT_FOUND',
  'INVALID_MODEL_CONFIGURATION',
  'INSUFFICIENT_QUOTA',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
]);

/** A single transient provider hiccup must not disable a proven model across runs. */
const MODEL_TRANSIENT_FAILURES_REQUIRED_FOR_COOLDOWN = 2;

/**
 * Concurrent AI races (request planning, triage, and similar fan-out) resolve
 * routing at nearly the same instant. Re-reading the model table and recent
 * health log once per lane can serialize several remote PostgreSQL round trips
 * before the provider request even starts. A very short snapshot lets those
 * sibling lanes share one authoritative DB read without materially delaying
 * health changes between user operations.
 */
/*
 * A single generation stage may start several provider-diverse AI lanes at
 * once.  Re-querying model/health state from Supabase for each lane made the
 * PREPARING wall clock 12-19s even when the winning provider answered in ~3s.
 * Ninety seconds keeps consecutive stages/runs from repeating remote model-health
 * reads while still refreshing operational routing state frequently. A stale
 * snapshot is served only while a background refresh is already in flight.
 */
const ROUTABLE_EXECUTION_SNAPSHOT_TTL_MS = 90_000;
const ROUTABLE_EXECUTION_SNAPSHOT_STALE_MAX_AGE_MS = 10 * 60_000;
const ROUTABLE_EXECUTION_REFRESH_SOFT_WAIT_MS = 250;
const ROUTABLE_EXECUTION_WARMUP_RETRY_DELAYS_MS = [0, 4_000, 12_000, 30_000] as const;

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
export class AiModelRoutingService implements OnModuleInit {
  private readonly logger = new Logger(AiModelRoutingService.name);
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

  private readonly modelHardCooldownMs: number;

  private executionAvailabilityCache: {
    readonly refreshedAt: number;
    readonly expiresAt: number;
    readonly models: readonly AiModel[];
  } | null = null;

  private executionAvailabilityInFlight: Promise<AiModel[]> | null = null;

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

    const configuredHardCooldownMinutes = Number(
      configService.get<string>('AI_MODEL_HARD_COOLDOWN_MINUTES'),
    );
    const hardCooldownMinutes =
      Number.isInteger(configuredHardCooldownMinutes) &&
      configuredHardCooldownMinutes >= MIN_MODEL_HARD_COOLDOWN_MINUTES &&
      configuredHardCooldownMinutes <= MAX_MODEL_HARD_COOLDOWN_MINUTES
        ? configuredHardCooldownMinutes
        : DEFAULT_MODEL_HARD_COOLDOWN_MINUTES;
    this.modelHardCooldownMs = hardCooldownMinutes * 60 * 1_000;
  }

  invalidateExecutionAvailabilityCache(): void {
    this.executionAvailabilityCache = null;
  }

  onModuleInit(): void {
    /*
     * Warm routing state without extending Nest startup. The database can still
     * be settling when the first zero-delay warmup fires, so one failed attempt
     * must not leave the next text request paying the full remote routing read.
     * Retries are bounded, background-only, and become no-ops as soon as the
     * ordinary cache has been populated. Runtime routing order is unchanged.
     */
    for (const delayMs of ROUTABLE_EXECUTION_WARMUP_RETRY_DELAYS_MS) {
      setTimeout(() => {
        const cached = this.executionAvailabilityCache;
        if (cached && cached.expiresAt > Date.now()) return;
        void this.resolveSharedExecutionAvailability().catch((error: unknown) => {
          this.logger.debug(
            `AI routing snapshot warmup failed non-fatally at delay=${delayMs}ms; runtime routing remains authoritative. error=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }, delayMs);
    }
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

    const models = await this.resolveSharedExecutionAvailability();

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
   * Resolves one short-lived availability snapshot for ordinary routing.
   *
   * The first caller performs the two DB-backed reads (routable models and
   * recent provider/model health). Concurrent sibling callers await the same
   * promise. The cache intentionally lasts only a couple of seconds: it exists
   * to deduplicate one provider-diverse race, not to hide operational changes.
   */
  private async resolveSharedExecutionAvailability(): Promise<AiModel[]> {
    const now = Date.now();
    const cached = this.executionAvailabilityCache;
    if (cached && cached.expiresAt > now) {
      return [...cached.models];
    }

    const startRefresh = (): Promise<AiModel[]> => {
      if (this.executionAvailabilityInFlight) {
        return this.executionAvailabilityInFlight;
      }

      const request = this.aiModelsService
        .getRoutableModels()
        .then((routableModels) =>
          this.filterTemporarilyUnavailableProviders(routableModels),
        )
        .then((models) => {
          const refreshedAt = Date.now();
          this.executionAvailabilityCache = {
            refreshedAt,
            expiresAt: refreshedAt + ROUTABLE_EXECUTION_SNAPSHOT_TTL_MS,
            models: [...models],
          };
          return models;
        })
        .finally(() => {
          this.executionAvailabilityInFlight = null;
        });

      this.executionAvailabilityInFlight = request;
      return request;
    };

    const refresh = startRefresh();
    const staleUsable = Boolean(
      cached &&
        cached.models.length > 0 &&
        now - cached.refreshedAt <= ROUTABLE_EXECUTION_SNAPSHOT_STALE_MAX_AGE_MS,
    );

    if (!staleUsable) {
      return [...(await refresh)];
    }

    /*
     * Stale-while-revalidate is deliberate here. A saturated remote PostgreSQL
     * pool must not hold PREPARING for tens of seconds after a healthy routing
     * snapshot was already observed by this backend. Give the refresh a short
     * chance to finish, then use the last-known healthy snapshot while the DB
     * refresh continues in the background. The stale window is bounded so an
     * administrator change cannot remain hidden indefinitely.
     */
    const refreshed = await Promise.race<AiModel[] | null>([
      refresh,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ROUTABLE_EXECUTION_REFRESH_SOFT_WAIT_MS),
      ),
    ]);
    if (refreshed) {
      return [...refreshed];
    }

    return [...cached!.models];
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
   * Provider-wide blocking is reserved for provider-scoped hard availability
   * failures (quota/auth/forbidden), because a
   * generic OpenRouter 429 may affect only one free model or upstream host.
   * RATE_LIMIT and PROVIDER_UNAVAILABLE therefore create a model-level
   * cooldown only after repeated consecutive transient failures. TIMEOUT and
   * NETWORK failures are handled inside the current bounded caller and never
   * become cross-run blockers by themselves. Provider-wide blocking is based
   * only on provider-scoped logs (aiModelId=null), so one model-specific quota
   * failure cannot disable healthy sibling models from the same provider. Other
   * models remain eligible, and a later success resets the run.
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
    const modelTransientCutoff = new Date(
      Date.now() - this.modelTransientCooldownMs,
    );
    const modelHardCutoff = new Date(Date.now() - this.modelHardCooldownMs);
    const earliestCutoff = new Date(
      Math.min(
        providerCutoff.getTime(),
        modelTransientCutoff.getTime(),
        modelHardCutoff.getTime(),
      ),
    );

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
        log.aiModelId === null &&
        (
          log.isSuccess ||
          (log.errorCode !== null &&
            PROVIDER_HARD_UNAVAILABLE_ERROR_CODES.has(log.errorCode))
        ) &&
        !latestLogByProvider.has(log.providerKey)
      ) {
        latestLogByProvider.set(log.providerKey, {
          isSuccess: log.isSuccess,
          errorCode: log.errorCode,
          createdAt: log.createdAt,
        });
      }

      if (log.aiModelId && log.createdAt >= modelHardCutoff) {
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
        latestLog.errorCode !== null &&
        PROVIDER_HARD_UNAVAILABLE_ERROR_CODES.has(latestLog.errorCode)
      ) {
        blockedProviders.add(providerKey);
      }
    }

    for (const [modelId, modelLogs] of recentLogsByModel) {
      const latestModelLog = modelLogs[0];
      if (
        latestModelLog &&
        latestModelLog.createdAt >= modelHardCutoff &&
        !latestModelLog.isSuccess &&
        latestModelLog.errorCode !== null &&
        MODEL_HARD_UNAVAILABLE_ERROR_CODES.has(latestModelLog.errorCode)
      ) {
        blockedModels.add(modelId);
        continue;
      }

      let consecutiveTransientFailures = 0;

      for (const log of modelLogs) {
        if (log.createdAt < modelTransientCutoff) {
          break;
        }
        if (log.isSuccess) {
          break;
        }

        if (
          log.errorCode === null ||
          !MODEL_CROSS_RUN_TRANSIENT_ERROR_CODES.has(log.errorCode)
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