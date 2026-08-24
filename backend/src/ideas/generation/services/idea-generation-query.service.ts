import { Injectable, NotFoundException } from '@nestjs/common';
import { IdeaGenerationRunStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import type { GetGenerationRunsQueryDto } from '../dto/get-generation-runs-query.dto';
import {
  buildIdeaBenchmarkSummary,
  IDEA_BENCHMARK_CANDIDATE_SELECT,
  mapIdeaBenchmarkCandidate,
} from '../mappers/idea-benchmark-response.mapper';

/**
 * Read-only application service for idea-generation monitoring endpoints.
 *
 * Persisted stage sequence values remain the canonical internal pipeline
 * order. A contiguous displaySequence is added only to API responses.
 * Benchmark Decimal values are converted into JSON-safe numbers through one
 * shared mapper used by user and administrator idea-detail endpoints.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationQueryService {
  constructor(private readonly prisma: PrismaService) { }

  /** Returns paginated generation runs owned by one authenticated user. */
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


  /** Returns the newest non-terminal generation run owned by the user. */
  async findActiveUserRun(userId: string) {
    const run = await this.prisma.ideaGenerationRun.findFirst({
      where: {
        userId,
        status: {
          in: [
            IdeaGenerationRunStatus.QUEUED,
            IdeaGenerationRunStatus.RUNNING,
            IdeaGenerationRunStatus.RETRYING,
            IdeaGenerationRunStatus.PAUSED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        idea: { select: { id: true, title: true } },
        stages: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!run) return null;

    const currentStage = run.stages.find(
      (stage) => stage.stageKey === run.currentStageKey,
    );

    return {
      ...run,
      currentStageLabel: currentStage?.displayName ?? null,
      stages: run.stages.map((stage, index) => ({
        ...stage,
        displaySequence: index + 1,
      })),
    };
  }

  /** Returns one generation run when it belongs to the authenticated user. */
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
            { finalScore: 'desc' },
            { overallScore: 'desc' },
            { responseTimeMs: 'asc' },
          ],
          select: IDEA_BENCHMARK_CANDIDATE_SELECT,
        },
      },
    });

    if (!run) {
      throw new NotFoundException('The generation run was not found.');
    }

    const benchmarkCandidates = run.benchmarkCandidates.map(
      mapIdeaBenchmarkCandidate,
    );

    return {
      ...run,
      stages: run.stages.map((stage, index) => ({
        ...stage,
        displaySequence: index + 1,
      })),
      benchmarkCandidates,
      benchmarkSummary: buildIdeaBenchmarkSummary(
        benchmarkCandidates,
        run.contextSnapshot,
      ),
    };
  }
  /**
 * Returns one generation run owned by the current guest session.
 *
 * The guest session is resolved using the secure token stored in the
 * HTTP-only cookie. The generation run must belong to the resolved
 * guest-session record.
 *
 * The response intentionally exposes only guest-safe information:
 * - Current run status and progress.
 * - Public pipeline stages.
 * - Limited idea preview after generation completes.
 *
 * Advanced idea outputs, benchmark candidates, full abstracts, and
 * internal generation details are not returned to guests.
 *
 * @param guestSessionToken Guest token read from the HTTP-only cookie.
 * @param runId Idea-generation run identifier.
 * @returns Guest-safe generation-run details.
 *
 * @throws NotFoundException When the session or run does not exist.
 *
 * @author Eman
 */
  async findOwnedGuestRun(
    guestSessionToken: string,
    runId: string,
  ) {
    const guestSession =
      await this.prisma.guestSession.findUnique({
        where: {
          sessionToken: guestSessionToken,
        },
        select: {
          id: true,
          expiresAt: true,
        },
      });

    if (
      !guestSession ||
      this.isGuestSessionExpired(
        guestSession.expiresAt,
      )
    ) {
      throw new NotFoundException(
        'The guest session was not found or has expired.',
      );
    }

    const run =
      await this.prisma.ideaGenerationRun.findFirst({
        where: {
          id: runId,
          guestSessionId: guestSession.id,
        },
        select: {
          id: true,
          generationType: true,
          status: true,
          currentStageKey: true,
          progressPercent: true,
          errorCode: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,

          idea: {
            select: {
              id: true,
              title: true,
              limitedAbstract: true,
              problemStatement: true,
              objectives: true,
              targetUsers: true,
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
              startedAt: true,
              completedAt: true,
              attemptCount: true,
              maxAttempts: true,
            },
          },
        },
      });

    if (!run) {
      throw new NotFoundException(
        'The guest generation run was not found.',
      );
    }

    const currentStage = run.stages.find(
      (stage) =>
        stage.stageKey === run.currentStageKey,
    );

    return {
      ...run,

      currentStageLabel:
        currentStage?.displayName ?? null,

      stages: run.stages.map(
        (stage, index) => ({
          ...stage,
          displaySequence: index + 1,
        }),
      ),
    };
  }

  /**
   * Determines whether a guest session has expired.
   *
   * Null expiration values are treated as valid to remain compatible
   * with guest sessions created before expiration support was added.
   *
   * @param expiresAt Stored expiration date.
   * @returns True when the session has expired.
   */
  private isGuestSessionExpired(
    expiresAt: Date | null,
  ): boolean {
    return Boolean(
      expiresAt &&
      expiresAt.getTime() <= Date.now(),
    );
  }
}