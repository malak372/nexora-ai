import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiModel,
  AiModelHealthStatus,
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

import { calculateTotalPages } from '../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../utilities/base-query/builder';

import { CreateAiModelDto } from './dto/create-ai-model.dto';
import { GetAiModelsQueryDto } from './dto/get-ai-models-query.dto';
import { UpdateAiModelDto } from './dto/update-ai-model.dto';

import { PaginatedAiModelsResult } from './types/ai-models.type';

/**
 * Maximum number of attempts used for serializable transactions.
 *
 * PostgreSQL may reject one of two concurrent serializable
 * transactions to preserve data consistency.
 *
 * Retryable transaction conflicts are retried up to this limit.
 */
const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

/**
 * Minimal Prisma client shape required for AI-model lookup.
 *
 * Both PrismaService and Prisma.TransactionClient satisfy this
 * structural type.
 */
type AiModelLookupClient = Pick<Prisma.TransactionClient, 'aiModel'>;

/**
 * Health states that remain eligible for runtime routing.
 *
 * UNKNOWN is included because newly configured and reactivated
 * models have not yet completed a successful request or health check.
 *
 * UNAVAILABLE is intentionally excluded because the model should not
 * receive new provider requests until it is reset or reactivated.
 */
const ROUTABLE_HEALTH_STATUSES: readonly AiModelHealthStatus[] = [
  AiModelHealthStatus.HEALTHY,
  AiModelHealthStatus.DEGRADED,
  AiModelHealthStatus.UNKNOWN,
];

/**
 * Default fallback ordering.
 *
 * Higher-priority models are selected first.
 *
 * Older models are preferred when priorities are equal, providing
 * deterministic ordering.
 */
const AI_MODEL_FALLBACK_ORDER = [
  {
    priority: 'desc',
  },
  {
    createdAt: 'asc',
  },
] as const satisfies readonly Prisma.AiModelOrderByWithRelationInput[];

/**
 * Service responsible for managing AI-model configurations.
 *
 * Responsibilities:
 * - Create AI-model configurations.
 * - List, filter, sort, and search models.
 * - Update editable model metadata.
 * - Activate and deactivate models safely.
 * - Select one active and routable default model.
 * - Return fallback and routable models.
 * - Audit sensitive administrative changes.
 *
 * Business rules:
 * - Models are always created as non-default.
 * - isActive cannot be changed through the generic update endpoint.
 * - Only active models may become default.
 * - UNAVAILABLE models cannot become default.
 * - The default model cannot be deactivated.
 * - Only one model may be default at database level.
 * - Model changes and audit records are committed atomically.
 * - Changing provider connection data resets operational health.
 *
 * This service does not:
 * - Call external AI providers.
 * - Generate project ideas.
 * - Execute fallback requests.
 * - Record provider request success or failure.
 *
 * Runtime execution belongs to the central AI execution layer.
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
   * Creates a non-default AI-model configuration.
   *
   * The model and its audit record are created in the same
   * transaction.
   *
   * If either operation fails, both operations are rolled back.
   */
  async create(dto: CreateAiModelDto, actorId: string): Promise<AiModel> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const createdModel = await tx.aiModel.create({
          data: {
            provider: dto.provider,

            modelName: dto.modelName,

            apiModelId: dto.apiModelId,

            displayName: this.normalizeOptionalText(dto.displayName),

            description: this.normalizeOptionalText(dto.description),

            priority: dto.priority ?? 0,

            weight: dto.weight ?? 1,

            maxOutputTokens: dto.maxOutputTokens ?? 2048,

            inputCostPerMillion: dto.inputCostPerMillion ?? 0,

            outputCostPerMillion: dto.outputCostPerMillion ?? 0,

            isActive: dto.isActive ?? true,

            /*
             * Default selection is never allowed during creation.
             *
             * It must use the dedicated setDefault() operation.
             */
            isDefault: false,
          },
        });

        await this.auditService.createLog(
          {
            actorId,

            action: AuditAction.ADMIN_CREATE_AI_MODEL,

            targetType: AuditTargetType.AI_MODEL,

            targetId: createdModel.id,

            newValue: this.toAuditJson(createdModel),
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
   * Returns paginated and filtered AI-model configurations.
   *
   * The data query and count query are executed inside one Prisma
   * batch transaction to provide consistent pagination metadata.
   */
  async findAll(query: GetAiModelsQueryDto): Promise<PaginatedAiModelsResult> {
    const { page, limit, skip, take } = buildPagination(query);

    const search = query.search?.trim();

    const where: Prisma.AiModelWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(query.provider !== undefined && {
        provider: query.provider,
      }),

      ...(query.healthStatus !== undefined && {
        healthStatus: query.healthStatus,
      }),

      ...(query.isActive !== undefined && {
        isActive: query.isActive === 'true',
      }),

      ...(query.isDefault !== undefined && {
        isDefault: query.isDefault === 'true',
      }),

      ...(search
        ? {
            OR: [
              {
                modelName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },

              {
                apiModelId: {
                  contains: search,
                  mode: 'insensitive',
                },
              },

              {
                displayName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },

              {
                description: {
                  contains: search,
                  mode: 'insensitive',
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
        'provider',
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

    const [data, total] = await this.prisma.$transaction([
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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Returns one AI model by ID.
   *
   * Throws NotFoundException when no matching record exists.
   */
  async findOne(id: string): Promise<AiModel> {
    return this.findOneOrThrow(this.prisma, id);
  }

  /**
   * Updates editable AI-model metadata.
   *
   * Activation, deactivation, default selection, and operational
   * health fields are intentionally not directly supported here.
   *
   * When provider connection information changes, operational health
   * is automatically reset because the new configuration has not yet
   * been validated by a successful provider request.
   *
   * Connection-related fields:
   * - provider
   * - apiModelId
   *
   * The update and audit log are committed atomically.
   */
  async update(
    id: string,
    dto: UpdateAiModelDto,
    actorId: string,
  ): Promise<AiModel> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'At least one AI model field must be provided.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const oldModel = await this.findOneOrThrow(tx, id);

        /*
         * A change to the provider or the external API model
         * identifier means the previous health state is no longer
         * valid.
         *
         * The model must return to UNKNOWN until a real provider
         * request succeeds.
         */
        const shouldResetHealth =
          dto.provider !== undefined || dto.apiModelId !== undefined;

        const updatedModel = await tx.aiModel.update({
          where: {
            id,
          },

          data: {
            ...(dto.provider !== undefined && {
              provider: dto.provider,
            }),

            ...(dto.modelName !== undefined && {
              modelName: dto.modelName,
            }),

            ...(dto.apiModelId !== undefined && {
              apiModelId: dto.apiModelId,
            }),

            ...(dto.displayName !== undefined && {
              displayName: this.normalizeOptionalText(dto.displayName),
            }),

            ...(dto.description !== undefined && {
              description: this.normalizeOptionalText(dto.description),
            }),

            ...(dto.priority !== undefined && {
              priority: dto.priority,
            }),

            ...(dto.weight !== undefined && {
              weight: dto.weight,
            }),

            ...(dto.maxOutputTokens !== undefined && {
              maxOutputTokens: dto.maxOutputTokens,
            }),

            ...(dto.inputCostPerMillion !== undefined && {
              inputCostPerMillion: dto.inputCostPerMillion,
            }),

            ...(dto.outputCostPerMillion !== undefined && {
              outputCostPerMillion: dto.outputCostPerMillion,
            }),

            /*
             * Reset internal health state only when provider
             * connection configuration changes.
             *
             * Administrative fields such as displayName, priority,
             * weight, or pricing do not require a health reset.
             */
            ...(shouldResetHealth && {
              healthStatus: AiModelHealthStatus.UNKNOWN,

              consecutiveFailures: 0,

              lastHealthCheckAt: null,

              lastFailureAt: null,
            }),
          },
        });

        await this.auditService.createLog(
          {
            actorId,

            action: AuditAction.ADMIN_UPDATE_AI_MODEL,

            targetType: AuditTargetType.AI_MODEL,

            targetId: id,

            oldValue: this.toAuditJson(oldModel),

            newValue: this.toAuditJson(updatedModel),
          },
          tx,
        );

        return updatedModel;
      });
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Sets one AI model as the system default.
   *
   * Requirements:
   * - The model must exist.
   * - The model must be active.
   * - The model must not be UNAVAILABLE.
   *
   * The operation uses serializable isolation to protect against
   * concurrent default-model changes.
   *
   * PostgreSQL serialization conflicts are retried automatically.
   */
  async setDefault(id: string, actorId: string): Promise<AiModel> {
    return this.runSerializableTransaction(async (tx) => {
      const selectedModel = await this.findOneOrThrow(tx, id);

      if (!selectedModel.isActive) {
        throw new BadRequestException(
          'Inactive AI models cannot be set as default.',
        );
      }

      if (selectedModel.healthStatus === AiModelHealthStatus.UNAVAILABLE) {
        throw new BadRequestException(
          'Unavailable AI models cannot be set as default.',
        );
      }

      /*
       * The requested state already exists, so no database update
       * or duplicate audit entry is required.
       */
      if (selectedModel.isDefault) {
        return selectedModel;
      }

      const oldDefault = await tx.aiModel.findFirst({
        where: {
          isDefault: true,
        },
      });

      /*
       * Clear the previous default inside the same transaction.
       */
      await tx.aiModel.updateMany({
        where: {
          isDefault: true,
        },

        data: {
          isDefault: false,
        },
      });

      const newDefault = await tx.aiModel.update({
        where: {
          id,
        },

        data: {
          isDefault: true,
        },
      });

      await this.auditService.createLog(
        {
          actorId,

          action: AuditAction.ADMIN_SET_DEFAULT_AI_MODEL,

          targetType: AuditTargetType.AI_MODEL,

          targetId: id,

          oldValue: this.toAuditJson(oldDefault),

          newValue: this.toAuditJson(newDefault),
        },
        tx,
      );

      return newDefault;
    });
  }

  /**
   * Returns the configured active default AI model.
   *
   * This method is intended for administrative inspection.
   *
   * Runtime AI execution should use AiModelRoutingService because
   * routing also considers model health and fallback models.
   */
  async getDefaultModel(): Promise<AiModel> {
    const model = await this.prisma.aiModel.findFirst({
      where: {
        isDefault: true,
        isActive: true,
      },
    });

    if (!model) {
      throw new NotFoundException('No active default AI model is configured.');
    }

    return model;
  }

  /**
   * Deactivates a non-default AI model.
   *
   * The default model cannot be deactivated because that would
   * leave the system default configuration invalid.
   *
   * The update and audit log are committed atomically.
   */
  async deactivate(id: string, actorId: string): Promise<AiModel> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const oldModel = await this.findOneOrThrow(tx, id);

        if (oldModel.isDefault) {
          throw new BadRequestException(
            'The default AI model cannot be deactivated. Select another default model first.',
          );
        }

        /*
         * The model is already inactive.
         *
         * Return it without creating a redundant audit log.
         */
        if (!oldModel.isActive) {
          return oldModel;
        }

        const updatedModel = await tx.aiModel.update({
          where: {
            id,
          },

          data: {
            isActive: false,
          },
        });

        await this.auditService.createLog(
          {
            actorId,

            action: AuditAction.ADMIN_DEACTIVATE_AI_MODEL,

            targetType: AuditTargetType.AI_MODEL,

            targetId: id,

            oldValue: this.toAuditJson(oldModel),

            newValue: this.toAuditJson(updatedModel),
          },
          tx,
        );

        return updatedModel;
      });
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Activates an inactive AI model.
   *
   * Activation does not automatically make the model default.
   *
   * A reactivated model returns to UNKNOWN health because its
   * provider availability must be established again.
   *
   * The update and audit log are committed atomically.
   */
  async activate(id: string, actorId: string): Promise<AiModel> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const oldModel = await this.findOneOrThrow(tx, id);

        /*
         * The model is already active.
         *
         * Return it without creating a redundant audit log.
         */
        if (oldModel.isActive) {
          return oldModel;
        }

        const updatedModel = await tx.aiModel.update({
          where: {
            id,
          },

          data: {
            isActive: true,

            healthStatus: AiModelHealthStatus.UNKNOWN,

            consecutiveFailures: 0,

            lastHealthCheckAt: null,

            lastFailureAt: null,
          },
        });

        await this.auditService.createLog(
          {
            actorId,

            action: AuditAction.ADMIN_ACTIVATE_AI_MODEL,

            targetType: AuditTargetType.AI_MODEL,

            targetId: id,

            oldValue: this.toAuditJson(oldModel),

            newValue: this.toAuditJson(updatedModel),
          },
          tx,
        );

        return updatedModel;
      });
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Returns active and routable fallback models.
   *
   * Excludes:
   * - The configured default model.
   * - Inactive models.
   * - UNAVAILABLE models.
   *
   * Higher-priority models are returned first.
   */
  async getFallbackModels(): Promise<AiModel[]> {
    return this.prisma.aiModel.findMany({
      where: {
        isActive: true,

        isDefault: false,

        healthStatus: {
          in: [...ROUTABLE_HEALTH_STATUSES],
        },
      },

      orderBy: [...AI_MODEL_FALLBACK_ORDER],
    });
  }

  /**
   * Returns all active and routable AI models.
   *
   * The configured default model is returned first, followed by
   * fallback models ordered by priority.
   */
  async getRoutableModels(): Promise<AiModel[]> {
    return this.prisma.aiModel.findMany({
      where: {
        isActive: true,

        healthStatus: {
          in: [...ROUTABLE_HEALTH_STATUSES],
        },
      },

      orderBy: [
        {
          isDefault: 'desc',
        },

        ...AI_MODEL_FALLBACK_ORDER,
      ],
    });
  }

  /**
   * Finds one AI model using either PrismaService or a Prisma
   * transaction client.
   *
   * Throws NotFoundException when the model does not exist.
   */
  private async findOneOrThrow(
    client: AiModelLookupClient,
    id: string,
  ): Promise<AiModel> {
    const model = await client.aiModel.findUnique({
      where: {
        id,
      },
    });

    if (!model) {
      throw new NotFoundException('AI model not found.');
    }

    return model;
  }

  /**
   * Executes a serializable Prisma transaction.
   *
   * PostgreSQL serialization conflicts use Prisma error P2034.
   *
   * Retryable conflicts are retried up to the configured limit.
   */
  private async runSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        lastError = error;

        const isRetryableConflict = this.isPrismaErrorCode(error, 'P2034');

        if (
          !isRetryableConflict ||
          attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS
        ) {
          this.handlePrismaError(error);
        }
      }
    }

    /*
     * This line is theoretically unreachable, but it satisfies
     * strict TypeScript control-flow analysis.
     */
    this.handlePrismaError(lastError);
  }

  /**
   * Converts a value into Prisma-compatible JSON.
   *
   * Date and Prisma Decimal values are serialized safely.
   */
  private toAuditJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === null || value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /**
   * Normalizes optional text for persistence.
   *
   * Rules:
   * - undefined means the property was not provided.
   * - Empty or whitespace-only values become null.
   * - Non-empty values have already been trimmed by the DTO.
   */
  private normalizeOptionalText(value?: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    return value.length > 0 ? value : null;
  }

  /**
   * Checks whether an unknown error is a Prisma known-request
   * error with the provided code.
   */
  private isPrismaErrorCode(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }

  /**
   * Checks whether unique-constraint metadata contains one of the
   * possible field or database-column names.
   *
   * Prisma may return:
   * - Prisma field names such as modelName.
   * - Database column names such as model_name.
   * - A database index name.
   *
   * Supporting both forms keeps conflict handling stable across
   * Prisma and PostgreSQL versions.
   */
  private includesUniqueField(
    target: readonly string[],
    ...possibleNames: string[]
  ): boolean {
    return possibleNames.some((name) => target.includes(name));
  }

  /**
   * Maps known Prisma errors into safe HTTP exceptions.
   */
  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = this.getUniqueTarget(error);

        const hasProvider = this.includesUniqueField(target, 'provider');

        const hasModelName = this.includesUniqueField(
          target,
          'modelName',
          'model_name',
        );

        const hasApiModelId = this.includesUniqueField(
          target,
          'apiModelId',
          'api_model_id',
        );

        const hasDefaultConstraint = this.includesUniqueField(
          target,
          'isDefault',
          'is_default',
          'ai_models_single_default_idx',
        );

        if (hasProvider && hasModelName) {
          throw new ConflictException(
            'An AI model with the same provider and model name already exists.',
          );
        }

        if (hasProvider && hasApiModelId) {
          throw new ConflictException(
            'An AI model with the same provider and API model identifier already exists.',
          );
        }

        if (hasDefaultConstraint) {
          throw new ConflictException(
            'Another AI model is already configured as default.',
          );
        }

        throw new ConflictException(
          'An AI model with the same unique configuration already exists.',
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException('AI model not found.');
      }

      if (error.code === 'P2034') {
        throw new ConflictException(
          'The AI model configuration was modified concurrently. Please retry.',
        );
      }
    }

    throw error;
  }

  /**
   * Normalizes Prisma unique-constraint metadata.
   *
   * Depending on the database and Prisma version, meta.target may
   * be returned as:
   * - A string field name.
   * - An array of field names.
   * - A database index name.
   */
  private getUniqueTarget(
    error: Prisma.PrismaClientKnownRequestError,
  ): string[] {
    const target = error.meta?.target;

    if (typeof target === 'string') {
      return [target];
    }

    if (Array.isArray(target)) {
      return target.filter((item): item is string => typeof item === 'string');
    }

    return [];
  }
}
