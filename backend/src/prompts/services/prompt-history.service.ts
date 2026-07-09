import { Injectable } from '@nestjs/common';
import { Prisma, PromptType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetPromptHistoryQueryDto } from '../dto/get-prompt-history-query.dto';

/**
 * Handles prompt history persistence and retrieval.
 *
 * Prompt history helps with:
 * - AI debugging
 * - Admin monitoring
 * - Prompt auditing
 * - Re-generating or reviewing previous AI requests
 *
 * @author Malak
 */
@Injectable()
export class PromptHistoryService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Saves any prompt sent to the AI provider.
   */
  async savePrompt(params: {
    collectionJobId?: string | null;
    ideaId?: string | null;
    promptType: PromptType;
    promptText: string;
  }) {
    return this.prisma.promptHistory.create({
      data: {
        collectionJobId: params.collectionJobId ?? undefined,
        ideaId: params.ideaId ?? undefined,
        promptType: params.promptType,
        promptText: params.promptText,
      },
    });
  }

  /**
   * Saves an idea generation prompt.
   */
  async saveIdeaGenerationPrompt(params: {
    collectionJobId: string;
    ideaId?: string | null;
    promptText: string;
  }) {
    return this.savePrompt({
      collectionJobId: params.collectionJobId,
      ideaId: params.ideaId,
      promptType: PromptType.IDEA_GENERATION,
      promptText: params.promptText,
    });
  }

  /**
   * Saves a direct unlock prompt.
   */
  async saveIdeaUnlockPrompt(params: {
    collectionJobId: string;
    ideaId: string;
    promptText: string;
  }) {
    return this.savePrompt({
      collectionJobId: params.collectionJobId,
      ideaId: params.ideaId,
      promptType: PromptType.IDEA_UNLOCK,
      promptText: params.promptText,
    });
  }

  /**
   * Returns paginated prompt history for Admin.
   */
  async findAll(query: GetPromptHistoryQueryDto) {
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
      this.prisma.promptHistory.count({
        where,
      }),
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
    const allowedSortFields = ['createdAt', 'promptType'] as const;

    type AllowedSortField = (typeof allowedSortFields)[number];

    const requestedSortBy = query.sortBy as AllowedSortField | undefined;

    const sortBy: AllowedSortField =
      requestedSortBy && allowedSortFields.includes(requestedSortBy)
        ? requestedSortBy
        : 'createdAt';

    const sortOrder: Prisma.SortOrder =
      query.sortOrder === 'asc' ? 'asc' : 'desc';

    return {
      [sortBy]: sortOrder,
    };
  }
}