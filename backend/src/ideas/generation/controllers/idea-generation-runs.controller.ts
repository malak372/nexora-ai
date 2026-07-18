import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  IdeaGenerationRunStatus,
  Prisma,
} from '@prisma/client';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';

import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

import { PrismaService } from '../../../prisma/prisma.service';

import { CancelGenerationRunDto } from '../dto/cancel-generation-run.dto';

import { GetGenerationRunsQueryDto } from '../dto/get-generation-runs-query.dto';

import { IdeaGenerationCancellationService } from '../pipeline/idea-generation-cancellation.service';

/**
 * Controller responsible for authenticated-user generation-run
 * monitoring and cancellation.
 *
 * Base route:
 * /users/idea-generation-runs
 *
 * Responsibilities:
 * - List generation runs belonging to the authenticated user.
 * - Retrieve one user-owned generation run.
 * - Include persisted stage progress.
 * - Request cooperative cancellation.
 *
 * Ownership is applied to every endpoint. A user cannot retrieve
 * or cancel another user's generation run.
 *
 * @author Malak
 */
@Controller('users/idea-generation-runs')
@UseGuards(JwtAuthGuard)
export class IdeaGenerationRunsController {
  constructor(
    private readonly prisma: PrismaService,

    private readonly cancellationService:
      IdeaGenerationCancellationService,
  ) {}

  /**
   * Retrieves paginated idea-generation runs belonging to the
   * authenticated user.
   *
   * Endpoint:
   * GET /users/idea-generation-runs
   *
   * @param currentUser Authenticated user.
   * @param query Validated filtering and pagination query.
   * @returns Paginated generation runs.
   */
  @Get()
  async getMyGenerationRuns(
    @CurrentUser()
    currentUser: AuthenticatedUser,

    @Query()
    query: GetGenerationRunsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.IdeaGenerationRunWhereInput =
      {
        userId: currentUser.id,

        ...(query.status
          ? {
              status: query.status,
            }
          : {}),

        ...(query.generationType
          ? {
              generationType:
                query.generationType,
            }
          : {}),

        ...(query.ideaId
          ? {
              ideaId: query.ideaId,
            }
          : {}),

        ...(query.domainId
          ? {
              collectionJob: {
                domainId:
                  query.domainId,
              },
            }
          : {}),
      };

    const [items, total] =
      await this.prisma.$transaction([
        this.prisma.ideaGenerationRun.findMany(
          {
            where,

            orderBy: {
              createdAt: 'desc',
            },

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
                orderBy: {
                  sequence: 'asc',
                },

                select: {
                  id: true,
                  stageKey: true,
                  displayName: true,
                  sequence: true,
                  status: true,
                  progressPercent: true,
                  resultPreview: true,
                  errorMessage: true,
                  attemptCount: true,
                  maxAttempts: true,
                  startedAt: true,
                  completedAt: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
        ),

        this.prisma.ideaGenerationRun.count({
          where,
        }),
      ]);

    return {
      data: items,

      pagination: {
        page,
        limit,
        total,

        totalPages:
          total === 0
            ? 0
            : Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves one user-owned generation run with ordered stage
   * progress.
   *
   * Endpoint:
   * GET /users/idea-generation-runs/:runId
   *
   * @param currentUser Authenticated user.
   * @param runId Generation-run identifier.
   * @returns Generation run and its stage records.
   */
  @Get(':runId')
  async getMyGenerationRun(
    @CurrentUser()
    currentUser: AuthenticatedUser,

    @Param(
      'runId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    runId: string,
  ) {
    await this.cancellationService
      .findOwnedRunOrThrow(runId, {
        type: 'USER',
        userId: currentUser.id,
      });

    return this.prisma.ideaGenerationRun.findUniqueOrThrow(
      {
        where: {
          id: runId,
        },

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
            orderBy: {
              sequence: 'asc',
            },
          },
        },
      },
    );
  }

  /**
   * Requests cooperative cancellation of one active user-owned
   * generation run.
   *
   * Endpoint:
   * POST /users/idea-generation-runs/:runId/cancel
   *
   * Cancellation is not a forceful process termination. The
   * active pipeline stops at its next safe cancellation
   * checkpoint.
   *
   * @param currentUser Authenticated user.
   * @param runId Generation-run identifier.
   * @param dto Optional cancellation reason.
   * @returns Updated cancellation state.
   */
  @Post(':runId/cancel')
  async cancelMyGenerationRun(
    @CurrentUser()
    currentUser: AuthenticatedUser,

    @Param(
      'runId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    runId: string,

    @Body()
    dto: CancelGenerationRunDto,
  ) {
    const result =
      await this.cancellationService
        .requestCancellation(runId, {
          type: 'USER',
          userId: currentUser.id,
        });

    return {
      runId: result.run.id,

      status: result.run.status,

      cancelRequestedAt:
        result.run.cancelRequestedAt,

      cancellationRequested:
        result.run.cancelRequestedAt !==
          null ||
        result.run.status ===
          IdeaGenerationRunStatus.CANCELLED,

      alreadyRequested:
        result.alreadyRequested,

      alreadyTerminal:
        result.alreadyTerminal,

      reason: dto.reason ?? null,
    };
  }
}