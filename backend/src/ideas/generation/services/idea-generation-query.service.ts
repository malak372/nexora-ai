import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import type { GetGenerationRunsQueryDto } from '../dto/get-generation-runs-query.dto';

/**
 * Read-only application service for generation-run monitoring endpoints.
 *
 * Keeping Prisma queries here leaves controllers responsible only for HTTP
 * mapping, authentication context, and input validation.
 */
@Injectable()
export class IdeaGenerationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findUserRuns(userId: string, query: GetGenerationRunsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.IdeaGenerationRunWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.generationType
        ? { generationType: query.generationType }
        : {}),
      ...(query.ideaId ? { ideaId: query.ideaId } : {}),
      ...(query.domainId
        ? { collectionJob: { domainId: query.domainId } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ideaGenerationRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          idea: {
            select: {
              id: true,
              title: true,
              generationType: true,
              createdAt: true,
            },
          },
          collectionJob: {
            select: { id: true, domainId: true, status: true },
          },
          stages: {
            orderBy: { sequence: 'asc' },
          },
        },
      }),
      this.prisma.ideaGenerationRun.count({ where }),
    ]);

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOwnedUserRun(userId: string, runId: string) {
    const run = await this.prisma.ideaGenerationRun.findFirst({
      where: { id: runId, userId },
      include: {
        idea: {
          select: {
            id: true,
            title: true,
            generationType: true,
            limitedAbstract: true,
            partialAbstract: true,
            fullAbstract: true,
            createdAt: true,
          },
        },
        collectionJob: {
          select: {
            id: true,
            domainId: true,
            status: true,
            totalPosts: true,
            totalComments: true,
            startedAt: true,
            completedAt: true,
          },
        },
        stages: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!run) {
      throw new NotFoundException('The generation run was not found.');
    }

    return run;
  }
}