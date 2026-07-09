import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetPromptHistoryQueryDto } from '../dto/get-prompt-history-query.dto';
import { PaginatedPromptHistory } from '../types/prompt-history.type';
import { SavePromptParams } from '../types/save-prompt-params.type';

const ALLOWED_PROMPT_HISTORY_SORT_FIELDS = [
  'createdAt',
  'promptType',
  'estimatedInputTokens',
] as const;

type PromptHistorySortField =
  (typeof ALLOWED_PROMPT_HISTORY_SORT_FIELDS)[number];

/**
 * Handles prompt history persistence and retrieval.
 *
 * Prompt history helps with:
 * - AI debugging
 * - Admin monitoring
 * - Prompt auditing
 * - Reviewing the exact prompt template version used
 *
 * @author Malak
 */
@Injectable()
export class PromptHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saves any prompt sent to the AI provider.
   */
  async savePrompt(params: SavePromptParams) {
    return this.prisma.promptHistory.create({
      data: {
        collectionJobId: params.collectionJobId ?? undefined,
        ideaId: params.ideaId ?? undefined,
        promptType: params.promptType,
        promptText: params.promptText,
        templateHash: params.templateHash ?? undefined,
        estimatedInputTokens: params.estimatedInputTokens ?? undefined,
      },
    });
  }

  /**
   * Returns paginated prompt history for Admin.
   */
  async findAll(
    query: GetPromptHistoryQueryDto,
  ): Promise<PaginatedPromptHistory> {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);
    const skip = (page - 1) * limit;

    const where = this.buildWhereClause(query);
    const orderBy = this.buildOrderByClause(query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.promptHistory.findMany({
        where,
        skip,
        take: limit,
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
              createdAt: true,
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Builds Prisma where clause for prompt history filters.
   */
  private buildWhereClause(
    query: GetPromptHistoryQueryDto,
  ): Prisma.PromptHistoryWhereInput {
    const where: Prisma.PromptHistoryWhereInput = {};

    if (query.promptType) {
      where.promptType = query.promptType;
    }

    if (query.ideaId) {
      where.ideaId = query.ideaId;
    }

    if (query.collectionJobId) {
      where.collectionJobId = query.collectionJobId;
    }

    if (query.templateHash) {
      where.templateHash = query.templateHash;
    }

    if (query.search) {
      where.promptText = {
        contains: query.search,
        mode: 'insensitive',
      };
    }

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        gte: query.fromDate ? new Date(query.fromDate) : undefined,
        lte: query.toDate ? new Date(query.toDate) : undefined,
      };
    }

    return where;
  }

  /**
   * Builds safe orderBy clause.
   */
  private buildOrderByClause(
    query: GetPromptHistoryQueryDto,
  ): Prisma.PromptHistoryOrderByWithRelationInput {
    const requestedSortBy = query.sortBy as PromptHistorySortField | undefined;

    const sortBy: PromptHistorySortField =
      requestedSortBy &&
      ALLOWED_PROMPT_HISTORY_SORT_FIELDS.includes(requestedSortBy)
        ? requestedSortBy
        : 'createdAt';

    const sortOrder: Prisma.SortOrder =
      query.sortOrder === 'asc' ? 'asc' : 'desc';

    return {
      [sortBy]: sortOrder,
    };
  }
}