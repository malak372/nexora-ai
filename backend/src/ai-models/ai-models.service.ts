import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiModel,
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../utilities/base-query/builder';

import { calculateTotalPages } from '../utilities/analytics/analytics.helper';

import { CreateAiModelDto } from './dto/create-ai-model.dto';
import { GetAiModelsQueryDto } from './dto/get-ai-models-query.dto';
import { UpdateAiModelDto } from './dto/update-ai-model.dto';

/**
 * Service responsible for managing AI models.
 *
 * Responsibilities:
 * - Create AI model configurations.
 * - List and filter AI models.
 * - Update editable model metadata.
 * - Select exactly one active default model.
 * - Activate and deactivate models safely.
 * - Provide the default model to AiService.
 * - Audit all sensitive administrative operations.
 *
 * Business rules:
 * - A model is created as non-default.
 * - Only active models may become default.
 * - The default model cannot be deactivated.
 * - Only one model may be default at database level.
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
   * Creates a new AI model configuration.
   */
  async create(
    dto: CreateAiModelDto,
    actorId?: string,
  ): Promise<AiModel> {
    try {
      const createdModel = await this.prisma.aiModel.create({
        data: {
          provider: dto.provider,
          modelName: dto.modelName.trim(),
          apiModelId: dto.apiModelId.trim(),
          displayName: this.normalizeOptionalText(dto.displayName),
          description: this.normalizeOptionalText(dto.description),
          priority: dto.priority ?? 0,
          isActive: dto.isActive ?? true,
          isDefault: false,
        },
      });

      await this.auditService.createLog({
        actorId,
        action: AuditAction.ADMIN_CREATE_AI_MODEL,
        targetType: AuditTargetType.AI_MODEL,
        targetId: createdModel.id,
        newValue: this.toAuditJson(createdModel),
      });

      return createdModel;
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Returns paginated and filtered AI model configurations.
   */
  async findAll(query: GetAiModelsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const dateFilter = buildDateFilter(query);
    const search = query.search?.trim();

    const where: Prisma.AiModelWhereInput = {
      ...(dateFilter ?? {}),

      ...(query.provider !== undefined && {
        provider: query.provider,
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
        'isActive',
        'isDefault',
      ] as const,
      'createdAt',
    );

    const [data, total] = await Promise.all([
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
   * Returns one AI model by its ID.
   */
  async findOne(id: string): Promise<AiModel> {
    const model = await this.prisma.aiModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException('AI model not found.');
    }

    return model;
  }

  /**
   * Updates editable AI model metadata.
   *
   * Business rules:
   * - The default model cannot be deactivated.
   * - Default selection is handled only through setDefault().
   */
  async update(
    id: string,
    dto: UpdateAiModelDto,
    actorId?: string,
  ): Promise<AiModel> {
    const oldModel = await this.findOne(id);

    if (oldModel.isDefault && dto.isActive === false) {
      throw new BadRequestException(
        'The default AI model cannot be deactivated. Select another default model first.',
      );
    }

    try {
      const updatedModel = await this.prisma.aiModel.update({
        where: { id },
        data: {
          ...(dto.provider !== undefined && {
            provider: dto.provider,
          }),

          ...(dto.modelName !== undefined && {
            modelName: dto.modelName.trim(),
          }),

          ...(dto.apiModelId !== undefined && {
            apiModelId: dto.apiModelId.trim(),
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

          ...(dto.isActive !== undefined && {
            isActive: dto.isActive,
          }),
        },
      });

      await this.auditService.createLog({
        actorId,
        action: AuditAction.ADMIN_UPDATE_AI_MODEL,
        targetType: AuditTargetType.AI_MODEL,
        targetId: id,
        oldValue: this.toAuditJson(oldModel),
        newValue: this.toAuditJson(updatedModel),
      });

      return updatedModel;
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Sets one active AI model as the system default.
   *
   * The operation is transaction-safe.
   */
  async setDefault(
    id: string,
    actorId: string,
  ): Promise<AiModel> {
    const model = await this.findOne(id);

    if (!model.isActive) {
      throw new BadRequestException(
        'Inactive AI models cannot be set as default.',
      );
    }

    if (model.isDefault) {
      return model;
    }

    const oldDefault = await this.prisma.aiModel.findFirst({
      where: {
        isDefault: true,
      },
    });

    try {
      const updatedModel = await this.prisma.$transaction(
        async (tx) => {
          await this.clearDefaultModel(tx);

          return tx.aiModel.update({
            where: { id },
            data: {
              isDefault: true,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      await this.auditService.createLog({
        actorId,
        action: AuditAction.ADMIN_SET_DEFAULT_AI_MODEL,
        targetType: AuditTargetType.AI_MODEL,
        targetId: id,
        oldValue: this.toAuditJson(oldDefault),
        newValue: this.toAuditJson(updatedModel),
      });

      return updatedModel;
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Returns the single active default AI model.
   *
   * This method is consumed by AiService before sending
   * requests to an external provider.
   */
  async getDefaultModel(): Promise<AiModel> {
    const model = await this.prisma.aiModel.findFirst({
      where: {
        isDefault: true,
        isActive: true,
      },
    });

    if (!model) {
      throw new NotFoundException(
        'No active default AI model is configured.',
      );
    }

    return model;
  }

  /**
   * Deactivates a non-default AI model.
   */
  async deactivate(
    id: string,
    actorId?: string,
  ): Promise<AiModel> {
    const oldModel = await this.findOne(id);

    if (oldModel.isDefault) {
      throw new BadRequestException(
        'The default AI model cannot be deactivated. Select another default model first.',
      );
    }

    if (!oldModel.isActive) {
      return oldModel;
    }

    const updatedModel = await this.prisma.aiModel.update({
      where: { id },
      data: {
        isActive: false,
      },
    });

    await this.auditService.createLog({
      actorId,
      action: AuditAction.ADMIN_DEACTIVATE_AI_MODEL,
      targetType: AuditTargetType.AI_MODEL,
      targetId: id,
      oldValue: this.toAuditJson(oldModel),
      newValue: this.toAuditJson(updatedModel),
    });

    return updatedModel;
  }

  /**
   * Activates an inactive AI model.
   */
  async activate(
    id: string,
    actorId?: string,
  ): Promise<AiModel> {
    const oldModel = await this.findOne(id);

    if (oldModel.isActive) {
      return oldModel;
    }

    const updatedModel = await this.prisma.aiModel.update({
      where: { id },
      data: {
        isActive: true,
      },
    });

    await this.auditService.createLog({
      actorId,
      action: AuditAction.ADMIN_UPDATE_AI_MODEL,
      targetType: AuditTargetType.AI_MODEL,
      targetId: id,
      oldValue: this.toAuditJson(oldModel),
      newValue: this.toAuditJson(updatedModel),
    });

    return updatedModel;
  }

  /**
   * Returns ordered active fallback candidates.
   *
   * The default model is excluded.
   *
   * This method prepares the module for future automatic
   * provider fallback without changing consumers.
   */
  async getFallbackModels(): Promise<AiModel[]> {
    return this.prisma.aiModel.findMany({
      where: {
        isActive: true,
        isDefault: false,
      },
      orderBy: [
        {
          priority: 'desc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  /**
   * Clears the default flag from all models.
   *
   * Must only be called inside a Prisma transaction.
   */
  private async clearDefaultModel(
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.aiModel.updateMany({
      where: {
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    });
  }

  /**
   * Converts application values into Prisma-compatible JSON.
   */
  private toAuditJson(
    value: unknown,
  ): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value ?? null),
    ) as Prisma.InputJsonValue;
  }

  /**
   * Trims optional text and converts empty strings to null.
   */
  private normalizeOptionalText(
    value?: string,
  ): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim();

    return normalized.length > 0 ? normalized : null;
  }

  /**
   * Maps known Prisma errors to safe HTTP exceptions.
   */
  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'An AI model with the same provider, model name, or API identifier already exists.',
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(
          'AI model not found.',
        );
      }
    }

    throw error;
  }
}