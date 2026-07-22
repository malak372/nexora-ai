import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import type { GetGenerationRunsQueryDto } from '../dto/get-generation-runs-query.dto';

/**
 * Read-only application service for idea-generation monitoring endpoints.
 *
 * Persisted stage sequence values remain the canonical internal pipeline
 * order. A contiguous displaySequence is added only to API responses.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns paginated generation runs owned by one authenticated user.
   */
  async findUserRuns(userId: string, query: GetGenerationRunsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.IdeaGenerationRunWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.generationType ? { generationType: query.generationType } : {}),
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
            select: {
              id: true,
              domainId: true,
              status: true,
            },
          },
          stages: {
            orderBy: { sequence: 'asc' },
          },
        },
      }),
      this.prisma.ideaGenerationRun.count({ where }),
    ]);

    return {
      data: items.map((run) => ({
        ...run,
        stages: run.stages.map((stage, index) => ({
          ...stage,
          displaySequence: index + 1,
        })),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  /**
   * Returns one generation run when it belongs to the authenticated user.
   * Benchmark Decimal values are converted to JSON-safe numbers.
   */
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
        stages: {
          orderBy: { sequence: 'asc' },
        },
        benchmarkCandidates: {
          orderBy: [
            { selected: 'desc' },
            { overallScore: 'desc' },
            { responseTimeMs: 'asc' },
          ],
          select: {
            id: true,
            aiModelId: true,
            providerKey: true,
            apiModelId: true,
            modelName: true,
            displayName: true,
            overallScore: true,
            innovationScore: true,
            marketFitScore: true,
            technicalQualityScore: true,
            completenessScore: true,
            originalityScore: true,
            inputTokens: true,
            outputTokens: true,
            costEstimate: true,
            responseTimeMs: true,
            selected: true,
            errorCode: true,
            errorMessage: true,
            createdAt: true,
            aiModel: {
              select: {
                modelName: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException('The generation run was not found.');
    }

    return {
      ...run,
      stages: run.stages.map((stage, index) => ({
        ...stage,
        displaySequence: index + 1,
      })),
      benchmarkCandidates: run.benchmarkCandidates.map((candidate) => ({
        ...candidate,
        overallScore: candidate.overallScore?.toNumber() ?? null,
        innovationScore: candidate.innovationScore?.toNumber() ?? null,
        marketFitScore: candidate.marketFitScore?.toNumber() ?? null,
        technicalQualityScore:
          candidate.technicalQualityScore?.toNumber() ?? null,
        completenessScore: candidate.completenessScore?.toNumber() ?? null,
        originalityScore: candidate.originalityScore?.toNumber() ?? null,
        costEstimate: candidate.costEstimate?.toNumber() ?? null,
      })),
    };
  }
}
