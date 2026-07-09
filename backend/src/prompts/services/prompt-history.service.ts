import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  Prisma,
  PromptType,
} from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';
import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { GetPromptHistoryQueryDto } from '../dto/get-prompt-history-query.dto';

/**
 * Service responsible for storing and retrieving AI prompt history.
 *
 * It keeps a trace of prompts sent to the AI provider and creates
 * audit logs for important prompt-related actions.
 *
 * @author Malak
 */
@Injectable()
export class PromptHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Saves a generated prompt in PromptHistory.
   *
   * This method is used after building a prompt and before/after sending it
   * to the AI provider, so the system can keep a traceable record of AI usage.
   *
   * @param params Prompt history data.
   * @returns Created prompt history record.
   */
  async savePrompt(params: {
    actorId?: string | null;
    collectionJobId?: string | null;
    ideaId?: string | null;
    promptType: PromptType;
    promptText: string;
    estimatedInputTokens?: number;
  }) {
    const promptHistory = await this.prisma.promptHistory.create({
      data: {
        collectionJobId: params.collectionJobId ?? null,
        ideaId: params.ideaId ?? null,
        promptType: params.promptType,
        promptText: params.promptText,
      },
    });

    await this.auditService.createLog({
      actorId: params.actorId ?? null,
      action: this.resolveAuditAction(params.promptType),
      targetType: AuditTargetType.PROMPT,
      targetId: promptHistory.id,
      newValue: {
        promptType: params.promptType,
        ideaId: params.ideaId ?? null,
        collectionJobId: params.collectionJobId ?? null,
        estimatedInputTokens: params.estimatedInputTokens ?? null,
      } as Prisma.InputJsonValue,
    });

    return promptHistory;
  }

  /**
   * Returns paginated prompt history records.
   *
   * Supports:
   * - pagination
   * - sorting
   * - date filtering
   * - filtering by idea
   * - filtering by collection job
   * - filtering by prompt type
   * - searching inside prompt text or idea title
   *
   * @param query Prompt history query filters.
   */
  async getPromptHistories(query: GetPromptHistoryQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);
    const where = this.buildWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'promptType'] as const,
      'createdAt',
    );

    const [data, total] = await Promise.all([
      this.prisma.promptHistory.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          idea: {
            select: {
              id: true,
              title: true,
              generationType: true,
              isUnlocked: true,
              unlockMethod: true,
            },
          },
          collectionJob: {
            select: {
              id: true,
              country: true,
              city: true,
              region: true,
              status: true,
              totalPosts: true,
              totalComments: true,
            },
          },
        },
      }),
      this.prisma.promptHistory.count({ where }),
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
   * Builds Prisma where conditions from query filters.
   */
  private buildWhere(
    query: GetPromptHistoryQueryDto,
  ): Prisma.PromptHistoryWhereInput {
    const dateFilter = buildDateFilter(query);

    return {
      ...(dateFilter ?? {}),
      ...(query.collectionJobId && {
        collectionJobId: query.collectionJobId,
      }),
      ...(query.ideaId && {
        ideaId: query.ideaId,
      }),
      ...(query.promptType && {
        promptType: query.promptType,
      }),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                promptText: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                idea: {
                  title: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  /**
   * Maps each prompt type to the most suitable audit action.
   */
  private resolveAuditAction(promptType: PromptType): AuditAction {
    switch (promptType) {
      case PromptType.IDEA_GENERATION:
        return AuditAction.USER_GENERATE_IDEA;

      case PromptType.IDEA_UNLOCK:
        return AuditAction.USER_UNLOCK_IDEA;

      case PromptType.NLP_ANALYSIS:
        return AuditAction.NLP_ANALYSIS_RUN;

      case PromptType.CHAT_RESPONSE:
        return AuditAction.USER_AI_CHAT;

      case PromptType.ABSTRACT_GENERATION:
        return AuditAction.ABSTRACT_GENERATION_RUN;

      default:
        return AuditAction.PROMPT_HISTORY_CREATED;
    }
  }
}