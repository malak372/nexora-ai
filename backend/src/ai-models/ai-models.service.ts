import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AiModelHealthStatus,
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

import type { AiModel } from '@prisma/client';

import {
  normalizeAiProviderKey,
  SUPPORTED_AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../ai/constants/ai-provider.constants';

import { AuditService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

import { calculateTotalPages } from '../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../utilities/base-query/builder';

import { AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS } from './constants/ai-model-health.constants';

import {
  DEFAULT_AI_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_AI_MODEL_PRIORITY,
  DEFAULT_AI_MODEL_WEIGHT,
} from './constants/ai-model.constants';

import { CreateAiModelDto } from './dto/create-ai-model.dto';
import { GetAiModelsQueryDto } from './dto/get-ai-models-query.dto';
import { UpdateAiModelDto } from './dto/update-ai-model.dto';

import type { PaginatedAiModelsResult } from './types/ai-models.type';

/**
 * Prisma client shape required for AI-model lookup operations.
 *
 * Both PrismaService and Prisma.TransactionClient satisfy this
 * structural contract.
 */
type AiModelLookupClient = Pick<
  Prisma.TransactionClient,
  'aiModel'
>;

/**
 * Operational health states eligible for runtime routing.
 *
 * UNKNOWN remains routable because newly created, updated, or
 * reactivated models may not have completed a successful execution yet.
 *
 * UNAVAILABLE is intentionally excluded from runtime routing.
 */
const ROUTABLE_HEALTH_STATUSES: readonly AiModelHealthStatus[] = [
  AiModelHealthStatus.HEALTHY,
  AiModelHealthStatus.DEGRADED,
  AiModelHealthStatus.UNKNOWN,
];

/**
 * Deterministic ordering used for routable and fallback models.
 *
 * Ordering rules:
 * 1. Models with higher numeric priority are preferred.
 * 2. Older models are preferred when priorities are equal.
 */
const AI_MODEL_FALLBACK_ORDER = [
  {
    priority: Prisma.SortOrder.desc,
  },
  {
    createdAt: Prisma.SortOrder.asc,
  },
] satisfies Prisma.AiModelOrderByWithRelationInput[];

/**
 * Service responsible for administrator AI-model management and
 * runtime model lookup.
 *
 * Provider keys are persisted as strings to keep the database
 * extensible. Before persistence, provider keys are validated against
 * provider adapters registered by the deployed backend.
 *
 * Business rules:
 * - New models are always created as non-default.
 * - Generic updates cannot change activation or default state.
 * - Only active and routable models may become default.
 * - The current default model cannot be deactivated.
 * - Administrative mutations and their audit records are persisted
 *   atomically.
 * - Changing providerKey or apiModelId resets operational health.
 * - Higher priority values are preferred during fallback routing.
 *
 * @author Malak
 */
@Injectable()
export class AiModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates a new non-default AI-model configuration.
   *
   * Model creation and audit-log creation are executed in the same
   * transaction.
   *
   * @param dto Validated administrator model configuration.
   * @param actorId Administrator performing the operation.
   * @returns Newly created AI-model record.
   *
   * @throws BadRequestException When the actor or provider key is invalid.
   * @throws ConflictException When the same provider and API model
   * combination already exists.
   */
  async create(
    dto: CreateAiModelDto,
    actorId: string,
  ): Promise<AiModel> {
    const normalizedActorId = this.requireIdentifier(
      actorId,
      'Actor ID',
    );

    const providerKey = this.resolveProviderKey(
      dto.providerKey,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const createdModel = await tx.aiModel.create({
          data: {
            providerKey,

            modelName: dto.modelName.trim(),

            apiModelId: dto.apiModelId.trim(),

            displayName: this.normalizeOptionalText(
              dto.displayName,
            ),

            description: this.normalizeOptionalText(
              dto.description,
            ),

            priority:
              dto.priority ??
              DEFAULT_AI_MODEL_PRIORITY,

            weight:
              dto.weight ??
              DEFAULT_AI_MODEL_WEIGHT,

            maxOutputTokens:
              dto.maxOutputTokens ??
              DEFAULT_AI_MODEL_MAX_OUTPUT_TOKENS,

            supportsJsonOutput:
              dto.supportsJsonOutput ?? false,

            supportsTools:
              dto.supportsTools ?? false,

            supportsVision:
              dto.supportsVision ?? false,

            contextWindow:
              dto.contextWindow ?? null,

            inputCostPerMillion:
              dto.inputCostPerMillion ?? 0,

            outputCostPerMillion:
              dto.outputCostPerMillion ?? 0,

            isActive:
              dto.isActive ?? true,

            /*
             * Default-model selection is intentionally handled through
             * a dedicated administrative endpoint.
             */
            isDefault: false,
          },
        });

        await this.auditService.createLog(
          {
            actorId: normalizedActorId,

            action:
              AuditAction.ADMIN_CREATE_AI_MODEL,

            targetType:
              AuditTargetType.AI_MODEL,

            targetId: createdModel.id,

            newValue:
              this.toAuditJson(createdModel),
          },
          tx,
        );

        return createdModel;
      });
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Returns filtered, sorted, and paginated AI-model configurations.
   *
   * Supported filters include:
   * - Provider key.
   * - Health status.
   * - Active state.
   * - Default state.
   * - Creation-date range.
   * - Free-text search.
   *
   * @param query Validated AI-model list query.
   * @returns Paginated AI-model result.
   */
  async findAll(
    query: GetAiModelsQueryDto,
  ): Promise<PaginatedAiModelsResult> {
    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

    const search = query.search?.trim();

    const where: Prisma.AiModelWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(query.providerKey !== undefined
        ? {
            providerKey: query.providerKey,
          }
        : {}),

      ...(query.healthStatus !== undefined
        ? {
            healthStatus: query.healthStatus,
          }
        : {}),

      ...(query.isActive !== undefined
        ? {
            isActive: query.isActive,
          }
        : {}),

      ...(query.isDefault !== undefined
        ? {
            isDefault: query.isDefault,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                providerKey: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                modelName: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                apiModelId: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                displayName: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                description: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'createdAt',
        'updatedAt',
        'modelName',
        'providerKey',
        'priority',
        'weight',
        'maxOutputTokens',
        'inputCostPerMillion',
        'outputCostPerMillion',
        'healthStatus',
        'isActive',
        'isDefault',
      ] as const,
      'createdAt',
    );

    const [data, total] =
      await this.prisma.$transaction([
        this.prisma.aiModel.findMany({
          where,
          skip,
          take,
          orderBy,
        }),

        this.prisma.aiModel.count({
          where,
        }),
      ]);

    return {
      data,

      meta: {
        page,
        limit,
        total,

        totalPages: calculateTotalPages(
          total,
          limit,
        ),
      },
    };
  }

  /**
   * Returns one AI model by identifier.
   *
   * @param id AI-model identifier.
   * @returns Matching AI-model record.
   *
   * @throws BadRequestException When the identifier is blank.
   * @throws NotFoundException When the model does not exist.
   */
  async findOne(id: string): Promise<AiModel> {
    const normalizedId = this.requireIdentifier(
      id,
      'AI model ID',
    );

    return this.findOneOrThrow(
      this.prisma,
      normalizedId,
    );
  }

  /**
   * Updates editable AI-model metadata.
   *
   * providerKey and apiModelId changes reset operational health because
   * the previously recorded health state no longer describes the
   * updated external model connection.
   *
   * Activation and default state are not handled by this method.
   *
   * @param id AI-model identifier.
   * @param dto Validated partial model update.
   * @param actorId Administrator performing the operation.
   * @returns Updated AI-model record.
   */
  async update(
    id: string,
    dto: UpdateAiModelDto,
    actorId: string,
  ): Promise<AiModel> {
    const normalizedId = this.requireIdentifier(
      id,
      'AI model ID',
    );

    const normalizedActorId = this.requireIdentifier(
      actorId,
      'Actor ID',
    );

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'At least one AI model field must be provided.',
      );
    }

    const nextProviderKey =
      dto.providerKey !== undefined
        ? this.resolveProviderKey(dto.providerKey)
        : undefined;

    const nextApiModelId =
      dto.apiModelId?.trim();

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const oldModel =
            await this.findOneOrThrow(
              tx,
              normalizedId,
            );

          const shouldResetHealth =
            (nextProviderKey !== undefined &&
              nextProviderKey !==
                oldModel.providerKey) ||
            (nextApiModelId !== undefined &&
              nextApiModelId !==
                oldModel.apiModelId);

          const updatedModel =
            await tx.aiModel.update({
              where: {
                id: normalizedId,
              },

              data: {
                ...(nextProviderKey !== undefined
                  ? {
                      providerKey:
                        nextProviderKey,
                    }
                  : {}),

                ...(dto.modelName !== undefined
                  ? {
                      modelName:
                        dto.modelName.trim(),
                    }
                  : {}),

                ...(nextApiModelId !== undefined
                  ? {
                      apiModelId:
                        nextApiModelId,
                    }
                  : {}),

                ...(dto.displayName !== undefined
                  ? {
                      displayName:
                        this.normalizeOptionalText(
                          dto.displayName,
                        ),
                    }
                  : {}),

                ...(dto.description !== undefined
                  ? {
                      description:
                        this.normalizeOptionalText(
                          dto.description,
                        ),
                    }
                  : {}),

                ...(dto.priority !== undefined
                  ? {
                      priority: dto.priority,
                    }
                  : {}),

                ...(dto.weight !== undefined
                  ? {
                      weight: dto.weight,
                    }
                  : {}),

                ...(dto.maxOutputTokens !== undefined
                  ? {
                      maxOutputTokens:
                        dto.maxOutputTokens,
                    }
                  : {}),

                ...(dto.supportsJsonOutput !==
                undefined
                  ? {
                      supportsJsonOutput:
                        dto.supportsJsonOutput,
                    }
                  : {}),

                ...(dto.supportsTools !== undefined
                  ? {
                      supportsTools:
                        dto.supportsTools,
                    }
                  : {}),

                ...(dto.supportsVision !== undefined
                  ? {
                      supportsVision:
                        dto.supportsVision,
                    }
                  : {}),

                ...(dto.contextWindow !== undefined
                  ? {
                      contextWindow:
                        dto.contextWindow,
                    }
                  : {}),

                ...(dto.inputCostPerMillion !==
                undefined
                  ? {
                      inputCostPerMillion:
                        dto.inputCostPerMillion,
                    }
                  : {}),

                ...(dto.outputCostPerMillion !==
                undefined
                  ? {
                      outputCostPerMillion:
                        dto.outputCostPerMillion,
                    }
                  : {}),

                ...(shouldResetHealth
                  ? {
                      healthStatus:
                        AiModelHealthStatus.UNKNOWN,

                      consecutiveFailures: 0,

                      lastHealthCheckAt: null,

                      lastFailureAt: null,
                    }
                  : {}),
              },
            });

          await this.auditService.createLog(
            {
              actorId: normalizedActorId,

              action:
                AuditAction.ADMIN_UPDATE_AI_MODEL,

              targetType:
                AuditTargetType.AI_MODEL,

              targetId: normalizedId,

              oldValue:
                this.toAuditJson(oldModel),

              newValue:
                this.toAuditJson(updatedModel),
            },
            tx,
          );

          return updatedModel;
        },
      );
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Sets one active and routable model as the system default.
   *
   * The operation uses a serializable transaction to prevent concurrent
   * requests from leaving multiple models marked as default.
   *
   * Selecting the current default model is treated as an idempotent
   * operation and does not create a duplicate audit record.
   *
   * @param id AI-model identifier.
   * @param actorId Administrator performing the operation.
   * @returns Selected default model.
   */
  async setDefault(
    id: string,
    actorId: string,
  ): Promise<AiModel> {
    const normalizedId = this.requireIdentifier(
      id,
      'AI model ID',
    );

    const normalizedActorId = this.requireIdentifier(
      actorId,
      'Actor ID',
    );

    return this.runSerializableTransaction(
      async (tx) => {
        const selectedModel =
          await this.findOneOrThrow(
            tx,
            normalizedId,
          );

        if (!selectedModel.isActive) {
          throw new BadRequestException(
            'Inactive AI models cannot be set as default.',
          );
        }

        if (
          selectedModel.healthStatus ===
          AiModelHealthStatus.UNAVAILABLE
        ) {
          throw new BadRequestException(
            'Unavailable AI models cannot be set as default.',
          );
        }

        if (selectedModel.isDefault) {
          return selectedModel;
        }

        const oldDefault =
          await tx.aiModel.findFirst({
            where: {
              isDefault: true,
            },
          });

        await tx.aiModel.updateMany({
          where: {
            isDefault: true,
          },

          data: {
            isDefault: false,
          },
        });

        const newDefault =
          await tx.aiModel.update({
            where: {
              id: normalizedId,
            },

            data: {
              isDefault: true,
            },
          });

        await this.auditService.createLog(
          {
            actorId: normalizedActorId,

            action:
              AuditAction.ADMIN_SET_DEFAULT_AI_MODEL,

            targetType:
              AuditTargetType.AI_MODEL,

            targetId: normalizedId,

            oldValue: oldDefault
              ? this.toAuditJson(oldDefault)
              : undefined,

            newValue:
              this.toAuditJson(newDefault),
          },
          tx,
        );

        return newDefault;
      },
    );
  }

  /**
   * Deactivates one non-default AI model.
   *
   * Deactivating an already inactive model is treated as an idempotent
   * operation.
   *
   * @param id AI-model identifier.
   * @param actorId Administrator performing the operation.
   * @returns Inactive AI-model record.
   *
   * @throws ConflictException When attempting to deactivate the
   * current default model.
   */
  async deactivate(
    id: string,
    actorId: string,
  ): Promise<AiModel> {
    const normalizedId = this.requireIdentifier(
      id,
      'AI model ID',
    );

    const normalizedActorId = this.requireIdentifier(
      actorId,
      'Actor ID',
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const oldModel =
            await this.findOneOrThrow(
              tx,
              normalizedId,
            );

          if (oldModel.isDefault) {
            throw new ConflictException(
              'The default AI model cannot be deactivated.',
            );
          }

          if (!oldModel.isActive) {
            return oldModel;
          }

          const updatedModel =
            await tx.aiModel.update({
              where: {
                id: normalizedId,
              },

              data: {
                isActive: false,
              },
            });

          await this.auditService.createLog(
            {
              actorId: normalizedActorId,

              action:
                AuditAction.ADMIN_DEACTIVATE_AI_MODEL,

              targetType:
                AuditTargetType.AI_MODEL,

              targetId: normalizedId,

              oldValue:
                this.toAuditJson(oldModel),

              newValue:
                this.toAuditJson(updatedModel),
            },
            tx,
          );

          return updatedModel;
        },
      );
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Activates one inactive AI model.
   *
   * Activation resets operational health to UNKNOWN so that future
   * executions can determine the current provider availability.
   *
   * Activating an already active model is treated as an idempotent
   * operation.
   *
   * @param id AI-model identifier.
   * @param actorId Administrator performing the operation.
   * @returns Active AI-model record.
   */
  async activate(
    id: string,
    actorId: string,
  ): Promise<AiModel> {
    const normalizedId = this.requireIdentifier(
      id,
      'AI model ID',
    );

    const normalizedActorId = this.requireIdentifier(
      actorId,
      'Actor ID',
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const oldModel =
            await this.findOneOrThrow(
              tx,
              normalizedId,
            );

          if (oldModel.isActive) {
            return oldModel;
          }

          const updatedModel =
            await tx.aiModel.update({
              where: {
                id: normalizedId,
              },

              data: {
                isActive: true,

                healthStatus:
                  AiModelHealthStatus.UNKNOWN,

                consecutiveFailures: 0,

                lastHealthCheckAt: null,

                lastFailureAt: null,
              },
            });

          await this.auditService.createLog(
            {
              actorId: normalizedActorId,

              action:
                AuditAction.ADMIN_ACTIVATE_AI_MODEL,

              targetType:
                AuditTargetType.AI_MODEL,

              targetId: normalizedId,

              oldValue:
                this.toAuditJson(oldModel),

              newValue:
                this.toAuditJson(updatedModel),
            },
            tx,
          );

          return updatedModel;
        },
      );
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Returns the active and routable default model.
   *
   * Only providers implemented by the deployed backend are considered.
   *
   * @returns Active and routable default model.
   *
   * @throws NotFoundException When no eligible default model exists.
   */
  async getDefaultModel(): Promise<AiModel> {
    const model =
      await this.prisma.aiModel.findFirst({
        where: {
          isDefault: true,

          isActive: true,

          providerKey: {
            in: [...SUPPORTED_AI_PROVIDER_KEYS],
          },

          healthStatus: {
            in: [...ROUTABLE_HEALTH_STATUSES],
          },
        },
      });

    if (!model) {
      throw new NotFoundException(
        'No active and routable default AI model is configured.',
      );
    }

    return model;
  }

  /**
   * Returns all active and routable AI models.
   *
   * Models are ordered by descending priority and ascending creation
   * time.
   *
   * @returns Ordered routable AI-model records.
   */
  async getRoutableModels(): Promise<AiModel[]> {
    return this.prisma.aiModel.findMany({
      where: {
        isActive: true,

        providerKey: {
          in: [...SUPPORTED_AI_PROVIDER_KEYS],
        },

        healthStatus: {
          in: [...ROUTABLE_HEALTH_STATUSES],
        },
      },

      orderBy: AI_MODEL_FALLBACK_ORDER,
    });
  }

  /**
   * Returns active and routable fallback models.
   *
   * An optional model identifier may be excluded, normally when that
   * model has already failed during the current logical execution.
   *
   * @param excludedModelId Optional model identifier to exclude.
   * @returns Ordered fallback AI-model records.
   */
  async getFallbackModels(
    excludedModelId?: string,
  ): Promise<AiModel[]> {
    const normalizedExcludedId =
      this.normalizeOptionalText(
        excludedModelId,
      );

    return this.prisma.aiModel.findMany({
      where: {
        isActive: true,

        providerKey: {
          in: [...SUPPORTED_AI_PROVIDER_KEYS],
        },

        healthStatus: {
          in: [...ROUTABLE_HEALTH_STATUSES],
        },

        ...(normalizedExcludedId
          ? {
              id: {
                not: normalizedExcludedId,
              },
            }
          : {}),
      },

      orderBy: AI_MODEL_FALLBACK_ORDER,
    });
  }

  /**
   * Finds one AI model using either PrismaService or an active Prisma
   * transaction.
   *
   * @param client Prisma lookup client.
   * @param id AI-model identifier.
   * @returns Matching AI-model record.
   *
   * @throws NotFoundException When the model does not exist.
   */
  private async findOneOrThrow(
    client: AiModelLookupClient,
    id: string,
  ): Promise<AiModel> {
    const model =
      await client.aiModel.findUnique({
        where: {
          id,
        },
      });

    if (!model) {
      throw new NotFoundException(
        'AI model not found.',
      );
    }

    return model;
  }

  /**
   * Runs an operation inside a serializable Prisma transaction.
   *
   * Prisma P2034 transaction conflicts are retried up to the configured
   * maximum number of attempts.
   *
   * @typeParam T Transaction result type.
   * @param operation Operation executed inside the transaction.
   * @returns Successful transaction result.
   */
  private async runSerializableTransaction<T>(
    operation: (
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <=
      AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          operation,
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel
                .Serializable,
          },
        );
      } catch (error: unknown) {
        lastError = error;

        const retryable =
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';

        const finalAttempt =
          attempt ===
          AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS;

        if (!retryable || finalAttempt) {
          this.handlePrismaError(error);
        }
      }
    }

    /*
     * Defensive exhaustiveness guard. The final failed attempt is
     * normally handled inside the loop.
     */
    this.handlePrismaError(lastError);
  }

  /**
   * Normalizes and validates one provider-registry key.
   *
   * @param providerKey Raw provider key.
   * @returns Supported normalized provider key.
   *
   * @throws BadRequestException When no deployed provider adapter
   * supports the supplied key.
   */
  private resolveProviderKey(
    providerKey: string,
  ): AiProviderKey {
    const normalizedProviderKey =
      normalizeAiProviderKey(providerKey);

    if (!normalizedProviderKey) {
      throw new BadRequestException(
        `Unsupported AI provider key: ${providerKey}`,
      );
    }

    return normalizedProviderKey;
  }

  /**
   * Normalizes optional text to a trimmed string or null.
   *
   * Blank strings are converted to null.
   *
   * @param value Optional raw text.
   * @returns Trimmed text or null.
   */
  private normalizeOptionalText(
    value: string | null | undefined,
  ): string | null {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue || null;
  }

  /**
   * Validates and normalizes a required identifier.
   *
   * @param value Raw identifier.
   * @param fieldName Human-readable field name.
   * @returns Trimmed non-empty identifier.
   *
   * @throws BadRequestException When the identifier is blank.
   */
  private requireIdentifier(
    value: string,
    fieldName: string,
  ): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(
        `${fieldName} is required.`,
      );
    }

    return normalizedValue;
  }

  /**
   * Converts a JavaScript value into a Prisma-compatible JSON value for
   * audit persistence.
   *
   * Prisma Decimal, Date, and other serializable model values are
   * converted through JSON serialization.
   *
   * @param value Value being stored in an audit record.
   * @returns Prisma-compatible JSON value.
   */
  private toAuditJson(
    value: unknown,
  ): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value),
    ) as Prisma.InputJsonValue;
  }

  /**
   * Maps known Prisma errors to safe HTTP exceptions.
   *
   * Supported mappings:
   * - P2002: Duplicate provider/API-model combination.
   * - P2025: AI model was not found.
   * - P2034: Transaction conflict or deadlock.
   *
   * Unknown errors are rethrown unchanged.
   *
   * @param error Prisma or application error.
   */
  private handlePrismaError(
    error: unknown,
  ): never {
    if (
      error instanceof
      Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'An AI model with the same provider key and API model ID already exists.',
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(
          'AI model not found.',
        );
      }

      if (error.code === 'P2034') {
        throw new ConflictException(
          'The AI model configuration was modified concurrently. Please retry.',
        );
      }
    }

    throw error;
  }
}